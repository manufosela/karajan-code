// KJC-BUG-0455 (#2933): `kj review --staged 2>&1 | tail -2 && git commit` committed
// with no verdict: the pipe hid the failed review and no hook ran the gate. The
// Sentinel now checks the verdict of the staged diff itself before a git commit.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { commitStaging } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

describe("commitStaging", () => {
  it("a commit after a piped review stages nothing of its own", () => {
    expect(commitStaging("kj review --staged 2>&1 | tail -2 && git commit -m 'x'")).toEqual({ commits: true, stages: false, dir: null });
    expect(commitStaging("git commit -F msg.txt")).toMatchObject({ commits: true, stages: false });
    expect(commitStaging("git commit --amend --no-edit")).toMatchObject({ commits: true, stages: false });
    expect(commitStaging("git -c user.name=a -C /repo commit -m x")).toEqual({ commits: true, stages: false, dir: "/repo" });
  });

  it("staging in the same command is seen: git add/rm/mv, -a, --all and paths", () => {
    for (const cmd of ["git add a.js && git commit -m x", "git rm a.js; git commit -m x", "git commit -am 'x'", "git commit -a -m x", "git commit --all -m x", "git commit -m x -- a.js", "git commit a.js -m x", "git commit -m x -a"]) {
      expect(commitStaging(cmd).stages, cmd).toBe(true);
    }
  });

  it("each option takes only its own value: attached, separate, --opt=value, and a value that looks like a flag", () => {
    for (const cmd of ["git commit --message=x", "git commit -mx", "git commit --author 'A <a@b>' -m x", "git commit -F -", "git commit -m '-a looks like a flag'", "git commit -s -m x", "git -C /r -c k=v commit --no-edit"]) {
      expect(commitStaging(cmd).stages, cmd).toBe(false);
    }
  });

  it("no commit, nothing to check", () => {
    expect(commitStaging("git log --oneline").commits).toBe(false);
    expect(commitStaging("echo 'git commit -m x'").commits).toBe(false);
  });
});

describe("the commit verdict gate (PreToolUse Bash)", () => {
  let dir, pre;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command }, cwd: dir }), encoding: "utf8", cwd: dir, env: { ...process.env } });
  const verdict = (state) => {
    const diff = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    const hash = crypto.createHash("sha256").update(diff.trimEnd(), "utf8").digest("hex");
    fs.mkdirSync(path.join(dir, ".karajan", "reviews"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "reviews", `${hash}.json`), JSON.stringify({ verdict: state, reviewer: "codex" }));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-commit-verdict-"));
    git("init", "-q", "-b", "fix/KJC-BUG-0455-x");
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "# gate\n");
    git("add", ".karajan/review-gate");
    git("commit", "-q", "-m", "chore: gate");
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
    fs.writeFileSync(path.join(dir, "a.js"), "export const a = 1;\n");
    git("add", "a.js");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a staged diff with no verdict cannot be committed, however the review was piped", () => {
    const r = bash("kj review --staged 2>&1 | tail -2 && git commit -m 'feat: a'");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/veredicto/);
  });

  it("a rejected verdict blocks the commit; an approved one lets it through", () => {
    verdict("rejected");
    expect(bash("git commit -m 'feat: a'").status).toBe(2);
    verdict("approved");
    expect(bash("git commit -m 'feat: a'").status).toBe(0);
  });

  it("staging and committing in one command is refused: the verdict cannot be checked first", () => {
    verdict("approved");
    const r = bash("git add a.js && git commit -m 'feat: a'");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/comandos separados/);
  });

  it("a repo that has not turned the gate on is not checked", () => {
    git("rm", "-q", "--cached", ".karajan/review-gate");
    git("commit", "-q", "-m", "chore: gate off");
    fs.writeFileSync(path.join(dir, "b.js"), "export const b = 1;\n");
    git("add", "b.js");
    expect(bash("git commit -m 'feat: b'").status).toBe(0);
  });
});
