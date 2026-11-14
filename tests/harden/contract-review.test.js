import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const harden = (contractReview) => hardenCommand({ projectDir: repo, profile: "minimal", ci: false, guidelines: false, contractReview, logger });
const rangeDiff = () => git("diff", "HEAD^..HEAD");

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
  process.env.KJ_NO_CONTRACT_REVIEW = "1";
  rmSync(repo, { recursive: true, force: true });
});

describe("harden reviews its own contract commit", () => {
  it("an approving reviewer leaves a verdict bound to the exact diff, which publish-pr counts", async () => {
    const review = async ({ projectDir, range }) => {
      expect(range).toMatch(/^[0-9a-f]{40}\^\.\.[0-9a-f]{40}$/);
      return saveVerdict(projectDir, rangeDiff(), { verdict: "approved", reviewer: "fake", issues: [] });
    };
    const res = await harden(review);
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("approved");
    expect(lines.join("\n")).toMatch(/contract commit [0-9a-f]{7} reviewed by fake: approved/);
    expect((await checkVerdict(repo, rangeDiff())).ok).toBe(true);
  });

  it("a rejecting reviewer: harden still ends ok, the findings are printed, no verdict is stored", async () => {
    const res = await harden(async () => ({ verdict: "rejected", reviewer: "fake", issues: [{ description: "workflow too wide" }] }));
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("rejected");
    expect(lines.join("\n")).toMatch(/workflow too wide/);
    expect(lines.join("\n")).toMatch(/needs a fix before the PR/);
    expect((await checkVerdict(repo, rangeDiff())).ok).toBe(false);
  });

  it("no reviewer available: harden ends ok and prints the exact command to run later", async () => {
    const res = await harden(async () => { throw new Error("no reviewer available"); });
    expect(res.ok).toBe(true);
    expect(res.contract.review.status).toBe("unavailable");
    const sha = git("rev-parse", "--short=7", "HEAD").trim();
    expect(lines.join("\n")).toContain(`kj review --range ${sha}^..${sha}`);
  });

  it("KJ_NO_CONTRACT_REVIEW=1 never calls the reviewer", async () => {
    process.env.KJ_NO_CONTRACT_REVIEW = "1";
    const res = await harden(async () => { throw new Error("must not be called"); });
    expect(res.contract.review.status).toBe("skipped");
  });
});
