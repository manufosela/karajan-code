// KJC-TSK-0668 — resource governance for external tools launched by kj.
// The semgrep CPU storm happened because nothing serialized concurrent
// scans, capped their parallelism, or killed their process tree on timeout.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jobsCap, acquireToolLock, governedExecFile, runGoverned } from "../../src/utils/tool-governor.js";

let locksDir;
beforeEach(() => { locksDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-locks-")); });
afterEach(() => { fs.rmSync(locksDir, { recursive: true, force: true }); });

describe("jobsCap", () => {
  it("uses half the CPUs, never less than 1", () => {
    expect(jobsCap(20)).toBe(10);
    expect(jobsCap(3)).toBe(1);
    expect(jobsCap(1)).toBe(1);
  });
});

describe("acquireToolLock", () => {
  it("acquires, blocks a second caller, and frees on release", async () => {
    const lock = await acquireToolLock("semgrep", { locksDir });
    await expect(acquireToolLock("semgrep", { locksDir, timeoutMs: 300, pollMs: 50 }))
      .rejects.toMatchObject({ code: "ELOCKTIMEOUT" });
    const other = await acquireToolLock("osv-scanner", { locksDir, timeoutMs: 300 }); // per-tool
    other.release();
    lock.release();
    expect(fs.existsSync(path.join(locksDir, "semgrep.lock"))).toBe(false);
  });

  it("steals a lock whose holder pid is dead", async () => {
    const lockPath = path.join(locksDir, "semgrep.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, startedAt: "x" }));
    const lock = await acquireToolLock("semgrep", { locksDir, timeoutMs: 2000 });
    expect(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
    lock.release();
  });
});

describe("governedExecFile", () => {
  it("resolves stdout on success; rejects with exit code and rescued stdout on failure", async () => {
    const { stdout } = await governedExecFile(process.execPath, ["-e", "console.log('ok')"]);
    expect(stdout.trim()).toBe("ok");
    await expect(governedExecFile(process.execPath, ["-e", "console.log('partial'); process.exit(2)"]))
      .rejects.toMatchObject({ code: 2, stdout: expect.stringContaining("partial") });
  });

  it("rejects with ENOENT for a missing binary", async () => {
    await expect(governedExecFile("definitely-not-a-real-binary-kj", []))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("kills the whole process tree on timeout", async () => {
    // The child spawns a grandchild that would outlive it if only the
    // direct child were killed — exactly the orphaned semgrep-core case.
    const script = "const{spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1e3)']);console.log('grandchild:'+g.pid);setInterval(()=>{},1e3);";
    const err = await governedExecFile(process.execPath, ["-e", script], { timeout: 1500 }).catch((e) => e);
    expect(err.killed).toBe(true);
    const grandchildPid = Number(String(err.stdout).match(/grandchild:(\d+)/)?.[1]);
    expect(grandchildPid).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(grandchildPid, 0)).toThrow(); // dead → ESRCH
  });
});

describe("runGoverned", () => {
  it("serializes concurrent runs of the same tool", async () => {
    const marker = path.join(locksDir, "overlap.txt");
    const script = `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},'start\\n');const t=Date.now();while(Date.now()-t<150){}fs.appendFileSync(${JSON.stringify(marker)},'end\\n');`;
    await Promise.all([
      runGoverned("node-tool", ["-e", script], { bin: process.execPath, lock: { locksDir } }),
      runGoverned("node-tool", ["-e", script], { bin: process.execPath, lock: { locksDir } }),
    ]);
    // Serialized ⇒ strict start,end,start,end — never two starts in a row.
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toEqual(["start", "end", "start", "end"]);
  });
});
