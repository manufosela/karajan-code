// KJC-TSK-1114 (plan KJC-TSK-1081): the generated PreToolUse hook. Guards 4
// (supervisor files named in Bash), 12 (MONO-0 lanes) and 13 (repo writes through
// Bash) deny as before with no sandbox, and step aside where it denies their paths.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";
import { declareTestIdentity } from "./_test-identity.js";

let dir, pre, idEnv;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...idEnv } });
const sandbox = (sb) => fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify({ sandbox: sb }));
const COVERING = {
  enabled: true, allowUnsandboxedCommands: false,
  filesystem: { denyWrite: [".karajan/harness", ".karajan/hooks", ".claude/settings.json", "kj.config.yml", ".ragignore", ".kj/worktrees"] },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sbx-retire-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.py"), "x = 1\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init && git worktree add -q .kj/worktrees/other -b other", { cwd: dir, env: gitEnv });
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".karajan/harness/\n.claude/\n.kj/\n");
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  idEnv = declareTestIdentity(dir);
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  // ADR 0034: guard 12 denies a lane another live session holds; s9 works in "other".
  const other = path.join(dir, ".kj", "worktrees", "other");
  spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s9", tool_name: "Edit", tool_input: { file_path: path.join(other, "src", "a.py") }, cwd: other }),
    encoding: "utf8", cwd: dir, env: { ...process.env, ...idEnv } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const CASES = [
  ["guard 4, supervisor files", "cp /tmp/x .karajan/harness/x.mjs", "supervisor"],
  ["guard 12, another lane", "echo x > .kj/worktrees/other/a.txt", "otro carril"],
  ["guard 13, repo write", "echo x > src/a.py", "Edit/Write"],
];

describe("Sentinel Bash-text guards and the host sandbox", () => {
  it.each(CASES)("%s: denies with no sandbox", (_, cmd, says) => {
    const r = bash(cmd);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(says);
  });

  it.each(CASES)("%s: still denies when the sandbox can be bypassed", (_, cmd, says) => {
    sandbox({ ...COVERING, allowUnsandboxedCommands: true });
    expect(bash(cmd).stderr).toContain(says);
  });

  it.each(CASES)("%s: steps aside where the sandbox denies its paths", (_, cmd, says) => {
    sandbox(COVERING);
    const r = bash(cmd);
    expect(r.stderr).not.toContain(says);
    expect(r.stderr).not.toMatch(/(Syntax|Reference|Type)Error/);
  });
});
