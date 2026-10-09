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
  // KJC-BUG-0289 (#1984): the lint/format/commit configs kj harden generates (at
  // the root or under a stack root) and the governance files are contract too.
  it("takes the generated configs, wherever harden put them, and the governance files", () => {
    write(".editorconfig", "root = true\n");
    write("commitlint.config.js", "export default {};\n");
    write("packages/api/ruff.toml", "line-length = 100\n");
    write(".karajan/rules.yml", "rules: []\n");
    write(".karajan/supervisor-signers.json", "[]\n");
    write(".karajan/security-level.json", "{}\n");
    write("packages/api/pyproject.toml", "[project]\n"); // the person's, not kj's
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(true);
    expect(committed()).toEqual([".editorconfig", ".karajan/rules.yml", ".karajan/security-level.json", ".karajan/supervisor-signers.json", "commitlint.config.js", "packages/api/ruff.toml"]);
  });

  // kj init captures the baseline BEFORE ensureGitRepo: outside a repository git
  // cannot answer, and the baseline is empty (everything generated later is kj's).
  it("contractChanges is empty, not an error, in a directory that is not a repository", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "kj-plain-"));
    try {
      fs.writeFileSync(path.join(plain, "CLAUDE.md"), "# mine\n");
      expect(contractChanges(plain)).toEqual(new Set());
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

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

  // KJC-BUG-0302: after a version bump kj harden regenerates the contract AND the
  // supervisor's hooks; committed together, the gate refused the contract commit
  // and the seal refused the stage, and the person had to unstage the hook by hand.
  it("a sealed supervisor that was regenerated is left to the seal, unstaged; a first install still rides", () => {
    write(".karajan/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    write(".karajan/supervisor-provenance.json", "{}\n");
    git("add", ".");
    git("commit", "-q", "-m", "chore: sealed supervisor");
    git("checkout", "-q", "-b", "chore/kj");
    generate();
    write(".karajan/hooks/pre-commit", "#!/bin/sh\n# regenerated\nexit 0\n");
    write(".karajan/supervisor-provenance.json", "{\"v\":2}\n");
    write(".karajan/hooks/pre-push", "#!/bin/sh\nexit 0\n"); // a new hook: first install, not a reseal
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(true);
    expect(committed()).toEqual([".claude/skills/kj-run/SKILL.md", ".github/workflows/kj-policy.yml", ".karajan/hooks/pre-push", ".karajan/review-gate", "CLAUDE.md"]);
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
    expect(git("status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M .karajan/hooks/pre-commit", " M .karajan/supervisor-provenance.json"]);
  });

  it("a commit git refuses names the files and the way to commit them", () => {
    write("README.md", "# app\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "chore: init");
    git("checkout", "-q", "-b", "chore/kj");
    write("hooks/pre-commit", "#!/bin/sh\necho no verdict >&2\nexit 1\n");
    fs.chmodSync(path.join(dir, "hooks", "pre-commit"), 0o755);
    git("config", "core.hooksPath", "hooks");
    generate();
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/no verdict.*git add -- '\.claude\/skills\/kj-run\/SKILL\.md'.*kj review --staged/s);
  });
});
