import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hardenCommand } from "../../src/commands/harden.js";
import { checkVerdict, saveVerdict } from "../../src/review/verdict-store.js";

// HU-4316 (KJC-BUG-0593): harden reviews the contract commit it makes.
let repo;
const lines = [];
const logger = { info: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) };
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
// KJC-BUG-0608: with history the hooks are the seal's, so the contract under review is the
// configs standard generates (minimal generates hooks alone, and its contract would be empty).
const harden = (contractReview) => hardenCommand({ projectDir: repo, profile: "standard", ci: false, guidelines: false, contractReview, logger });
const rangeDiff = () => git("diff", "HEAD^..HEAD");
const stagedPaths = () => git("diff", "--cached", "--name-only").trim();
const approve = async ({ projectDir }) => saveVerdict(projectDir, git("diff", "--cached"), { verdict: "approved", reviewer: "fake", issues: [] });
// HU-4361: the review gate's pre-commit, which lets in only a staged diff with an approved verdict.
const verdictStore = new URL("../../src/review/verdict-store.js", import.meta.url).href;
const installGate = () => {
  const check = `import { execFileSync } from "node:child_process"; import { checkVerdict } from "${verdictStore}"; const diff = execFileSync("git", ["diff", "--cached"], { encoding: "utf8" }); if (!(await checkVerdict(process.cwd(), diff)).ok) { console.error("kj: no approved cross-AI verdict for the staged diff"); process.exit(1); }`;
  writeFileSync(join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\nexec node --input-type=module -e '${check}'\n`, { mode: 0o755 });
  // harden points core.hooksPath at its own hooks; the env keeps this gate in force.
  Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: join(repo, ".git", "hooks") });
};

beforeEach(() => {
  delete process.env.KJ_NO_CONTRACT_REVIEW;
  lines.length = 0;
  repo = mkdtempSync(join(tmpdir(), "kj-contract-review-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git("add", "README.md");
  git("commit", "-qm", "chore: first");
  git("checkout", "-qb", "chore/kj");
});
afterEach(() => {
  for (const key of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) delete process.env[key];
  process.env.KJ_NO_CONTRACT_REVIEW = "1";
  rmSync(repo, { recursive: true, force: true });
});

describe("harden reviews its own contract commit", () => {
  it("an approving reviewer leaves a verdict bound to the exact diff, which publish-pr counts", async () => {
    const res = await harden(approve);
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("approved");
    expect(lines.join("\n")).toMatch(/the contract reviewed by fake: approved/);
    expect((await checkVerdict(repo, rangeDiff())).ok).toBe(true);
  });

  it("a rejecting reviewer: harden still ends ok, the findings are printed, nothing is committed", async () => {
    const res = await harden(async () => ({ verdict: "rejected", reviewer: "fake", issues: [{ description: "workflow too wide" }] }));
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("rejected");
    expect(lines.join("\n")).toMatch(/workflow too wide/);
    expect(lines.join("\n")).toMatch(/needs a fix before it is committed/);
    expect(res.contract.committed).toBe(false);
    expect(res.contract.reason).toMatch(/rejected the contract diff/);
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);
    expect(stagedPaths()).toBe("");
  });

  it("no reviewer available: harden ends ok and prints the exact command to run later", async () => {
    const res = await harden(async () => { throw new Error("no reviewer available"); });
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("unavailable");
    expect(res.contract.committed).toBe(true);
    const sha = git("rev-parse", "--short=7", "HEAD").trim();
    expect(lines.join("\n")).toContain(`Run later: kj review --range ${sha}^..${sha}`);
  });

  it("a repo with the gate: the contract alone is reviewed first, and what the person staged stays staged", async () => {
    installGate();
    writeFileSync(join(repo, "notes.md"), "mine\n");
    git("add", "notes.md");
    const seen = {};
    const res = await harden(async (opts) => {
      seen.reviewed = stagedPaths().split("\n").sort();
      seen.own = execFileSync("git", ["-C", repo, "diff", "--cached", "--name-only"], { encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: undefined } }).trim();
      return approve(opts);
    });
    expect(res.contract.committed).toBe(true);
    expect(seen.reviewed).toEqual(res.contract.files);
    expect(seen.own).toBe("notes.md");
    expect((await checkVerdict(repo, rangeDiff())).ok).toBe(true);
    expect(stagedPaths()).toBe("notes.md");
    expect(process.env.GIT_INDEX_FILE).toBeUndefined();
    expect(readdirSync(join(repo, ".git")).filter((f) => f.startsWith("kj-contract-index"))).toEqual([]);
  });

  it("a repo with the gate and no reviewer: the commit is tried and its failure is named", async () => {
    installGate();
    const res = await harden(async () => { throw new Error("no reviewer available"); });
    expect(res.contract.committed).toBe(false);
    expect(res.contract.reason).toMatch(/no approved cross-AI verdict/);
    expect(res.contract.reason).toContain("kj review --staged");
    expect(stagedPaths()).toBe("");
  });

  it("KJ_NO_CONTRACT_REVIEW=1 never calls the reviewer", async () => {
    process.env.KJ_NO_CONTRACT_REVIEW = "1";
    const res = await harden(async () => { throw new Error("must not be called"); });
    expect(res.contract.review.status).toBe("skipped");
    expect(res.contract.committed).toBe(true);
  });
});
