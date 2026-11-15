// KJC-BUG-0273: in a repo with history kj generated the whole contract (28
// files, 1193 lines) and left it to the agent, whose PR-size rules forbid such a
// commit. What kj generates, kj commits: only that, never on the base branch.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commitContract, commitContractReviewed, commitFailureReason, contractChanges } from "../../src/environment/contract-commit.js";

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
  // KJC-BUG-0346: kj env install wires the native RAG tool in .mcp.json; left out of
  // the contract, a fresh clone lost it and the agent found a file it never made.
  it("takes the .mcp.json kj env install wires, and only when kj generated it now", () => {
    const before = contractChanges(dir);
    write(".mcp.json", '{"mcpServers":{"kj-rag":{"command":"kj-rag-mcp","args":[]}}}\n');
    expect(contractChanges(dir).has(".mcp.json")).toBe(true);
    expect(before.has(".mcp.json")).toBe(false);
  });

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
    // KJC-BUG-0522: nothing is left staged, so the seal can still run.
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
    expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
    expect(git("status", "--porcelain", "--untracked-files=all")).toMatch(/CLAUDE\.md/);
  });

  it("a commit-msg hook that exits 1 leaves only the person's own staged file, in a repo with history", () => {
    write("README.md", "# app\n");
    write("CLAUDE.md", "# old\n");
    git("add", "README.md", "CLAUDE.md");
    git("commit", "-q", "-m", "chore: init");
    git("checkout", "-q", "-b", "chore/kj");
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hooks-"));
    try {
      fs.writeFileSync(path.join(hooks, "commit-msg"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      git("config", "core.hooksPath", hooks);
      write("src/mine.js", "// mine\n");
      git("add", "src/mine.js");
      generate(); // CLAUDE.md modified (tracked) + three untracked files
      const res = commitContract({ projectDir: dir });
      expect(res.committed).toBe(false);
      expect(git("diff", "--cached", "--name-only").trim()).toBe("src/mine.js");
      expect(git("status", "--porcelain", "--untracked-files=all")).toMatch(/ M CLAUDE\.md/);
    } finally {
      fs.rmSync(hooks, { recursive: true, force: true });
    }
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

  // KJC-BUG-0600 (HU-4384): the seal covers every CI workflow and the governance config by hash.
  // A re-harden that re-pinned the judge put the tracked workflows in the contract too, the
  // policy refused them there, and kj harden warned that its contract was NOT committed.
  it("tracked sealed workflows and governance config that were regenerated are left to the seal", () => {
    write(".github/workflows/kj-policy.yml", "name: kj\n");
    write(".karajan/rules.yml", "rules: []\n");
    git("add", ".");
    git("commit", "-q", "-m", "chore: sealed governance");
    git("checkout", "-q", "-b", "chore/kj");
    write(".github/workflows/kj-policy.yml", "name: kj\n# judge re-pinned\n");
    write(".karajan/rules.yml", "rules: [a]\n");
    write(".github/workflows/kj-secrets.yml", "name: kj\n"); // a new workflow: first install, not a reseal
    write("CLAUDE.md", "# method\n");
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(true);
    expect(committed()).toEqual([".github/workflows/kj-secrets.yml", "CLAUDE.md"]);
    expect(git("status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M .github/workflows/kj-policy.yml", " M .karajan/rules.yml"]);
  });

  it("a contract of sealed files alone is nothing to commit, not a failure", () => {
    write(".github/workflows/kj-policy.yml", "name: kj\n");
    git("add", ".");
    git("commit", "-q", "-m", "chore: sealed governance");
    git("checkout", "-q", "-b", "chore/kj");
    write(".github/workflows/kj-policy.yml", "name: kj\n# judge re-pinned\n");
    expect(commitContract({ projectDir: dir })).toEqual({ committed: false, reason: "nothing of the contract to commit" });
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

  // KJC-BUG-0597: the first line of a hook's output (an eslint warning) was named as the reason.
  it("names the hook's own kj line, not the first line the hook printed", () => {
    write("README.md", "# app\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "chore: init");
    git("checkout", "-q", "-b", "chore/kj");
    write("hooks/pre-commit", "#!/bin/sh\necho 'eslint: warning on plugin-compat'\necho 'kj harden: format check failed' >&2\nexit 1\n");
    fs.chmodSync(path.join(dir, "hooks", "pre-commit"), 0o755);
    git("config", "core.hooksPath", "hooks");
    generate();
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/git could not commit the contract: kj harden: format check failed\./);
    expect(res.reason).not.toMatch(/eslint/);
  });
});

// HU-4361 (KJC-BUG-0599): the review reads HEAD plus the contract alone, before the commit.
describe("commitContractReviewed", () => {
  const stagedIn = (indexFile) => execFileSync("git", ["-C", dir, "diff", "--cached", "--name-only"], { encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: indexFile } }).trim().split("\n").sort();

  it("with no commit yet, the review reads the contract alone, then the contract commits", async () => {
    generate();
    write("notes.md", "mine\n");
    git("add", "notes.md");
    const res = await commitContractReviewed({ projectDir: dir, reviewStaged: async ({ indexFile }) => ({ status: "approved", seen: stagedIn(indexFile) }) });
    expect(res.committed).toBe(true);
    expect(res.review.seen).toEqual(res.files);
    expect(committed()).toEqual(res.files);
    expect(git("diff", "--cached", "--name-only").trim()).toBe("notes.md");
  });

  it("an index kj cannot make for the review commits nothing and names why", async () => {
    generate();
    write(`.git/kj-contract-index-${process.pid}.lock`, "");
    const res = await commitContractReviewed({ projectDir: dir, reviewStaged: async () => ({ status: "approved" }) });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/could not stage the contract alone for its review: .*kj-contract-index-\d+\.lock.*git add -- /);
    expect(git("status", "--porcelain")).toMatch(/\?\? CLAUDE\.md/);
  });
});

describe("commitFailureReason", () => {
  it("picks the last kj line over an eslint warning printed first", () => {
    const err = { stdout: "", stderr: "eslint: warning\nkj harden: format check failed\n" };
    expect(commitFailureReason(err)).toBe("kj harden: format check failed");
  });

  it("takes the kj line from stdout too, and the last one when there are several", () => {
    const err = { stdout: "kj: first\nnoise\n", stderr: "kj harden: lint failed\n" };
    expect(commitFailureReason(err)).toBe("kj harden: lint failed");
  });

  it("falls back to the last non-empty line when no line is the hook's", () => {
    const err = { stdout: "", stderr: "first\n\nlast line\n\n" };
    expect(commitFailureReason(err)).toBe("last line");
  });

  it("uses the error message when git printed nothing", () => {
    expect(commitFailureReason({ stdout: "", stderr: "", message: "Command failed" })).toBe("Command failed");
  });
});
