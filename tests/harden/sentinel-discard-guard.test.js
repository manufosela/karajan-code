// KJC-BUG-0238 (#1886): an agent does not discard changes it did not make. Foreign =
// dirty now and not clean when the session first touched it. No escape: data loss.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, pre;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const hook = (tool_name, tool_input) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name, tool_input }),
  encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1", KJ_SENTINEL_OFF: "1" } });
const bash = (command) => hook("Bash", { command });
const sessionEdits = (rel, content) => { hook("Edit", { file_path: path.join(dir, rel) }); fs.writeFileSync(path.join(dir, rel), content); };
const userEdits = (rel, content) => fs.writeFileSync(path.join(dir, rel), content);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-discard-"));
  fs.writeFileSync(path.join(dir, "a.js"), "a\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: dir, env: { ...process.env, ...gitEnv } });
  // As a real install: the harness and host settings are local, excluded (gate-gitignore).
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".karajan/harness/\n.claude/\n");
  installSentinelHooks({ projectDir: dir });
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("discard guard (PreToolUse Bash, no escape)", () => {
  it("denies the #1886 case: git checkout over the user's uncommitted change", () => {
    userEdits(".gitignore", "node_modules\n.karajan/identity.local.yml\n");
    const r = bash("git diff .gitignore && git checkout .gitignore");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(".gitignore");
    expect(r.stderr).toContain("git stash push");
  });

  it("lets the session discard its own change on a file that was clean", () => {
    sessionEdits("a.js", "session\n");
    expect(bash("git checkout -- a.js").status).toBe(0);
    expect(bash("git restore a.js").status).toBe(0);
  });

  it("an edit on top of the user's work does not make the file the session's", () => {
    userEdits("a.js", "user\n");
    sessionEdits("a.js", "user\nsession\n");
    expect(bash("git checkout -- a.js").status).toBe(2);
  });

  it("covers the whole-tree forms and fails closed on nested commands", () => {
    userEdits("a.js", "user\n");
    for (const cmd of ["git checkout .", "git restore .", "git -C . checkout -- .", "git reset --hard", "git checkout -f main", "git switch --discard-changes main",
      "command git checkout -- a.js", "/usr/bin/git reset --hard", "sudo git switch --discard-changes main", "sudo -u root git reset --hard", "echo $(git checkout -- a.js)",
      "git --git-dir .git checkout -- a.js", "g=git; $g checkout -- a.js", "git stash --quiet drop", "sh -c 'git checkout -- a.js'", "eval git reset --hard", "echo a.js | xargs git checkout --"]) {
      expect(bash(cmd).status, cmd).toBe(2);
    }
  });

  it("git clean -f removes untracked user files: denied; a file the session created is its own", () => {
    sessionEdits("new.js", "session\n");
    expect(bash("git clean -fd").status).toBe(0);
    userEdits("draft.md", "user\n");
    for (const cmd of ["git clean -f", "git clean -fd", "git clean -df", "git clean -xdf", "git clean --force", "git -c clean.requireForce=false clean -d", "git clean -fq", "git clean -f --quiet", "git clean -i", "git clean -fdi", "git clean -f -e -n", "git clean -fen", "git clean -fe -n", "sh -c 'git clean -f'", "echo $(git clean -f)", "$g clean -f"]) {
      expect(bash(cmd).status, cmd).toBe(2);
    }
    expect(bash("git clean -n").status).toBe(0);
  });

  it("git clean -ffd also removes a nested repository: its files count", () => {
    fs.mkdirSync(path.join(dir, "vendor"));
    execSync("git init -q", { cwd: path.join(dir, "vendor") });
    fs.writeFileSync(path.join(dir, "vendor", "user.txt"), "user\n");
    expect(bash("git clean -fd").status).toBe(0);
    expect(bash("git clean -ffd").status).toBe(2);
  });

  it("an exclude value never hides a foreign file from the probe (-efq excludes 'fq', not 'f')", () => {
    sessionEdits("new.js", "session\n");
    userEdits("f", "user\n");
    expect(bash("git clean -efq").status).toBe(2);
    expect(bash("git clean -f --exclude=f").status).toBe(2);
  });

  it("the dry-run probe never deletes, even with a pathspec named -n", () => {
    userEdits("-n", "user\n");
    expect(bash("git clean -f -- -n").status).toBe(2);
    expect(fs.existsSync(path.join(dir, "-n"))).toBe(true);
  });

  it("reads quoted paths whole: operators and blanks inside quotes are part of the name", () => {
    for (const name of ["user;work.txt", "my notes.md"]) {
      userEdits(name, "committed\n");
      execSync(`git add "${name}" && git commit -q -m add`, { cwd: dir, env: { ...process.env, ...gitEnv } });
      userEdits(name, "user\n");
      expect(bash(`git checkout -- '${name}'`).status, name).toBe(2);
      expect(bash(`git checkout -- "${name}"`).status, name).toBe(2);
    }
    expect(bash("git checkout -- my\\ notes.md").status).toBe(2);
  });

  it("fails closed on a path it cannot resolve ($VAR, substitution)", () => {
    sessionEdits("a.js", "session\n");
    expect(bash("git checkout -- $F").status).toBe(2);
    expect(bash("git checkout -- a.js").status).toBe(0);
  });

  it("stash drop and clear are always denied", () => {
    expect(bash("git stash drop").status).toBe(2);
    expect(bash("git stash clear").status).toBe(2);
  });

  it("does not block what discards nothing", () => {
    userEdits("a.js", "user\n");
    for (const cmd of ["git checkout -b feat/x", "git checkout main", "git restore --staged a.js", "git stash push -- a.js", "git status", "echo git checkout", "git diff a.js"]) {
      expect(bash(cmd).status, cmd).toBe(0);
    }
  });
});
