// STW-C (KJC-TSK-0791, epic KJC-PCS-0081) — the sweep's verdict has
// consequence where work starts: inform ALWAYS (once per session, impossible
// to miss), block ALMOST NEVER (only security and persistent red main, only
// when the project adopted it). Driven against the GENERATED hooks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, pre;
const runEdit = (env = {}) =>
  spawnSync("node", [pre], {
    input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, "src", "a.js") } }),
    encoding: "utf8", env: { ...process.env, KJ_ALLOW_IDENTITY: "1", ...env },
  });
const report = (invariants) => {
  fs.mkdirSync(path.join(dir, ".karajan", "steward"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "steward", "report.json"), JSON.stringify({ sweptAt: "2026-08-27T12:00:00Z", invariants }));
};
const adoptBlock = () => fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), "method_gates:\n  steward: block\n");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-stw-gate-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pretool gate × steward consequence", () => {
  it("broken invariants INFORM on the first edit — once per session, with sweep date and remedies", () => {
    report([{ id: "dead-code-trend", verdict: "broken", remedy: "delete what the inventory names" }, { id: "coverage-config", verdict: "unknown", renew: "kj steward sweep" }]);
    const first = runEdit();
    expect(first.status).toBe(0);
    const msg = JSON.parse(first.stdout.trim().split("\n").at(-1)).systemMessage;
    expect(msg).toMatch(/ROTO dead-code-trend/);
    expect(msg).toMatch(/no se afirma lo que no se sabe/); // unknown asks for refresh, never counts as broken
    expect(msg).toMatch(/2026-08-27/);
    const second = runEdit();
    expect(second.status).toBe(0);
    expect(second.stdout).not.toMatch(/systemMessage/); // once per session
  });

  it("a broken NON-defendible invariant never blocks, even with steward: block adopted", () => {
    report([{ id: "dead-code-trend", verdict: "broken", remedy: "x" }]);
    adoptBlock();
    expect(runEdit().status).toBe(0);
  });

  it("security or persistent red main DO block when the project adopted block — with remedy and a recorded escape", () => {
    report([{ id: "vulnerable-deps", verdict: "broken", evidence: "GHSA-z past its window", remedy: "update the package" }]);
    adoptBlock();
    const r = runEdit();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/vulnerable-deps/);
    expect(r.stderr).toMatch(/KJ_ALLOW_STEWARD/);
    expect(runEdit({ KJ_ALLOW_STEWARD: "1" }).status).toBe(0);
  });

  it("without adoption the same broken security invariant informs but does not block", () => {
    report([{ id: "vulnerable-deps", verdict: "broken", remedy: "update" }]);
    expect(runEdit().status).toBe(0);
  });

  it("no report at all: silence — a project that does not use the Steward is not gated by it", () => {
    const r = runEdit();
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/steward/i);
  });
});
