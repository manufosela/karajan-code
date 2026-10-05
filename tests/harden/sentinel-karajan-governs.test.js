// KJC-TSK-0920 (SNT-E): Karajan governs. A session does not change the project's
// policies, gate settings or exclusions to get past a gate (user's decision,
// 3-oct-2026), and every deny says so.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, pre;
const hook = (tool_name, tool_input, env = {}) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name, tool_input }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-governs-"));
  execSync("git init -q -b main", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Karajan governs", () => {
  it("the governance files are the human's: Edit/Write on them is denied, even with the Sentinel switched off", () => {
    // .karajan/rules.yml (KJC-TSK-0947, ADR 0016): the compiled rules are the user's to approve.
    // .karajan/rules.local.yml (KJC-TSK-0954, ADR 0017): the rules from the user's private sources.
    for (const rel of [".karajan/policy.yml", ".karajan/kj.config.yml", ".karajan/rules.yml", ".karajan/rules.local.yml", ".ragignore", "sub/.ragignore"]) {
      for (const tool of ["Edit", "Write"]) {
        const r = hook(tool, { file_path: path.join(dir, rel) }, { KJ_SENTINEL_OFF: "1" });
        expect(r.status, `${tool} ${rel}`).toBe(2);
        expect(r.stderr).toContain("kj report-issue");
      }
    }
  });

  it("every deny ends with the same line: Karajan governs", () => {
    const r = hook("Edit", { file_path: path.join(dir, ".karajan", "harness", "stop.mjs") });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Karajan gobierna/);
  });

  it("what is allowed stays silent", () => {
    const r = hook("Bash", { command: "git status" }, { KJ_SENTINEL_OFF: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/Karajan gobierna/);
  });
});
