// KJC-BUG-0185 — cold start. In a repo with no commit yet there is no base
// branch to protect and no coverage to demand: `git diff HEAD` cannot run, so
// the old code failed conservative and every turn ended red. The phase ends at
// the first commit. Driven against the GENERATED hooks, like every sentinel suite.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, postScript, stopScript;
const run = (script, payload) =>
  spawnSync("node", [script], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: { ...process.env, KJ_ALLOW_IDENTITY: "1" },
  });
const edit = (file) => ({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: file } });
const stop = () => run(stopScript, { session_id: "s1" });
const git = (args) => execSync(`git -c user.email=t@t -c user.name=t ${args}`, { cwd: dir });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bootstrap-"));
  fs.mkdirSync(path.join(dir, "src"));
  execSync("git init -q -b main", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  postScript = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  stopScript = path.join(dir, ".karajan", "harness", "stop.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("stop gate × repo with no commits", () => {
  const scaffold = () => {
    const file = path.join(dir, "src", "a.js");
    fs.writeFileSync(file, "export const hi = () => 'hi';\n");
    run(postScript, edit(file));
  };

  it("ends the turn green while the repo has no commit", () => {
    scaffold();
    const r = stop();
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/sin tocar un solo test/);
    expect(r.status).toBe(0);
  });

  it("demands the test again once the first commit exists", () => {
    git("add -A");
    git("commit -q -m bootstrap");
    scaffold();
    const r = stop();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/sin tocar un solo test/);
  });
});
