// KJC-TSK-0732 (issue #1371) — card-first against the DECLARED tracker.
// Rule separable from transport (exec/clock injected); adapter contract:
// {exists, live, status} JSON. Unverifiable degrades SAYING SO, never blocks.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyCardAlive } from "../../src/review/card-verify.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-cardverify-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const okExec = (out) => {
  const calls = [];
  const fn = async (cmd) => {
    calls.push(cmd);
    return { stdout: typeof out === "string" ? out : JSON.stringify(out) };
  };
  fn.calls = calls;
  return fn;
};

describe("verifyCardAlive", () => {
  it("without a verify_cmd it stays at branch-ref level and says how to raise it", async () => {
    const r = await verifyCardAlive({ ref: "LIN-123", verifyCmd: null, projectDir: dir });
    expect(r.level).toBe("branch-ref");
    expect(r.verified).toBeNull();
    expect(r.note).toContain("board.verify_cmd");
  });

  it("a live card verifies at tracker level; {ref} substituted, or appended without placeholder", async () => {
    const exec = okExec({ exists: true, live: true, status: "In Progress" });
    const r = await verifyCardAlive({ ref: "LIN-123", verifyCmd: "my-adapter --card {ref}", projectDir: dir, deps: { execFn: exec } });
    expect(r).toMatchObject({ level: "tracker", verified: true, status: "In Progress" });
    expect(exec.calls[0]).toBe("my-adapter --card LIN-123");
    await verifyCardAlive({ ref: "LIN-9", verifyCmd: "my-adapter", projectDir: dir, deps: { execFn: exec } });
    expect(exec.calls[1]).toBe("my-adapter LIN-9");
  });

  it("not-found and not-live are DEFINITIVE tracker verdicts, not degradations", async () => {
    const gone = await verifyCardAlive({ ref: "A-1", verifyCmd: "x", projectDir: dir, deps: { execFn: okExec({ exists: false }) } });
    expect(gone).toMatchObject({ level: "tracker", verified: false, status: "not-found" });
    const closed = await verifyCardAlive({ ref: "B-2", verifyCmd: "x", projectDir: dir, deps: { execFn: okExec({ exists: true, live: false, status: "Done" }) } });
    expect(closed).toMatchObject({ level: "tracker", verified: false, status: "Done" });
  });

  it("a broken adapter degrades to branch-ref with the failure named — it never blocks", async () => {
    const boom = async () => { throw new Error("ETIMEDOUT talking to tracker"); };
    const r = await verifyCardAlive({ ref: "C-3", verifyCmd: "x", projectDir: dir, deps: { execFn: boom } });
    expect(r.level).toBe("branch-ref");
    expect(r.verified).toBeNull();
    expect(r.note).toMatch(/degraded/i);
    expect(r.note).toContain("ETIMEDOUT");
  });

  it("a ref outside the card-ref alphabet NEVER reaches the shell (injection class)", async () => {
    const exec = okExec({ exists: true, live: true });
    const r = await verifyCardAlive({ ref: "x; rm -rf /", verifyCmd: "adapter {ref}", projectDir: dir, deps: { execFn: exec } });
    expect(exec.calls.length).toBe(0);
    expect(r).toMatchObject({ level: "branch-ref", verified: null });
  });

  it("non-JSON adapter output is a degradation, not a verdict", async () => {
    const r = await verifyCardAlive({ ref: "D-4", verifyCmd: "x", projectDir: dir, deps: { execFn: okExec("everything fine!") } });
    expect(r.level).toBe("branch-ref");
    expect(r.verified).toBeNull();
  });

  it("the cache is keyed by adapter too — one verify_cmd never answers for another", async () => {
    const now = () => 1_000_000;
    await verifyCardAlive({ ref: "G-7", verifyCmd: "adapter-a", projectDir: dir, deps: { execFn: okExec({ exists: true, live: true }), now } });
    const r = await verifyCardAlive({ ref: "G-7", verifyCmd: "adapter-b", projectDir: dir, deps: { execFn: okExec({ exists: false }), now } });
    expect(r.verified).toBe(false); // adapter-b ran — no stale hit from adapter-a
  });

  it("definitive results are cached (TTL); degradations are NOT — recovery is immediate", async () => {
    let t = 1_000_000;
    const now = () => t;
    const exec = okExec({ exists: true, live: true });
    await verifyCardAlive({ ref: "E-5", verifyCmd: "x", projectDir: dir, deps: { execFn: exec, now } });
    await verifyCardAlive({ ref: "E-5", verifyCmd: "x", projectDir: dir, deps: { execFn: exec, now } });
    expect(exec.calls.length).toBe(1); // second hit came from cache
    t += 11 * 60 * 1000; // past the TTL
    await verifyCardAlive({ ref: "E-5", verifyCmd: "x", projectDir: dir, deps: { execFn: exec, now } });
    expect(exec.calls.length).toBe(2);

    const boom = async () => { throw new Error("down"); };
    await verifyCardAlive({ ref: "F-6", verifyCmd: "x", projectDir: dir, deps: { execFn: boom, now } });
    const exec2 = okExec({ exists: true, live: true });
    const r = await verifyCardAlive({ ref: "F-6", verifyCmd: "x", projectDir: dir, deps: { execFn: exec2, now } });
    expect(r.verified).toBe(true); // the degradation was not cached
  });
});
