// KJC-BUG-0273: in a repo with history kj generated the whole contract (28
// files, 1193 lines) and left it to the agent, whose PR-size rules forbid such a
// commit. What kj generates, kj commits: only that, never on the base branch.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commitContract, contractChanges } from "../../src/environment/contract-commit.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const generate = () => {
  write(".karajan/review-gate", "x\n");
  write(".claude/skills/kj-run/SKILL.md", "# skill\n");
  write(".github/workflows/kj-policy.yml", "name: kj\n");
  write("CLAUDE.md", "# method\n");
};
const committed = () => git("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-contract-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("commitContract", () => {
  it("in a fresh repo it commits the contract, and nothing the person wrote, staged or not", () => {
    generate();
    write("src/app.js", "// mine\n");
    write("src/staged.js", "// mine, already staged\n");
    git("add", "src/staged.js");
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(true);
    expect(committed()).toEqual([".claude/skills/kj-run/SKILL.md", ".github/workflows/kj-policy.yml", ".karajan/review-gate", "CLAUDE.md"]);
    expect(git("log", "-1", "--format=%s")).toMatch(/^chore\(bootstrap\)/);
    expect(git("diff", "--cached", "--name-only").trim()).toBe("src/staged.js"); // still staged, still theirs
  });

  it("in a repo with history, on a branch, it commits what was generated and leaves what was dirty before", () => {
    write("README.md", "hi\n");
    write("CLAUDE.md", "# mine\n");
    git("add", "README.md", "CLAUDE.md");
    git("commit", "-qm", "chore: first");
    git("checkout", "-qb", "chore/kj");
    write("CLAUDE.md", "# mine, edited by hand before kj ran\n");
    const before = contractChanges(dir);
    expect([...before]).toEqual(["CLAUDE.md"]);
    write(".claude/settings.json", "{}\n"); // untracked but there before kj ran: not kj's either
    const earlier = contractChanges(dir);
    write(".karajan/review-gate", "x\n");
    write(".github/workflows/my-ci.yml", "name: mine\n"); // the person's workflow is not kj's
    const res = commitContract({ projectDir: dir, before: earlier });
    expect(res).toMatchObject({ committed: true, files: [".karajan/review-gate"] });
    expect(git("log", "-1", "--format=%s")).toMatch(/^chore\(kj\)/);
    const left = git("status", "--porcelain", "--untracked-files=all");
    expect(left).toMatch(/CLAUDE\.md/);
    expect(left).toMatch(/my-ci\.yml/);
  });

  it("on the base branch with history it refuses and says so; with nothing to commit it says that", () => {
    write("README.md", "hi\n");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    generate();
    const res = commitContract({ projectDir: dir, baseBranch: "main" });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/main.*git checkout -b .* git add -- \.claude\/skills\/kj-run\/SKILL\.md .*CLAUDE\.md/);
    expect(git("log", "--format=%s").trim()).toBe("chore: first");
    git("checkout", "-qb", "chore/kj");
    expect(commitContract({ projectDir: dir }).committed).toBe(true);
    expect(commitContract({ projectDir: dir })).toMatchObject({ committed: false, reason: expect.stringMatching(/nothing/) });
  });

  it("a commit git rejects (a hook, a missing identity) is reported, never thrown", () => {
    generate();
    git("config", "--unset", "user.email");
    git("config", "--unset", "user.name");
    const res = commitContract({ projectDir: dir, env: { ...process.env, GIT_AUTHOR_NAME: "", GIT_COMMITTER_NAME: "", HOME: dir, GIT_CONFIG_NOSYSTEM: "1" } });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/git could not commit/);
  });
});
