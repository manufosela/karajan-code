// HU-3533 (KJC-TSK-1445): a retry of kj code learns what the review rejected in the staged work,
// as kj run's loop handed the reviewer's findings to the next coder iteration.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { saveVerdict } from "../../src/review/verdict-store.js";
import { rejectedReview } from "../../src/review/retry-findings.js";

let dir;
const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-retry-"));
  git("init -q -b main");
  git("commit -q --allow-empty -m init");
  fs.writeFileSync(path.join(dir, "a.js"), "export const a = 1;\n");
  git("add a.js");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const issue = { id: "R-1", severity: "high", file: "a.js", line: 1, description: "a is never validated", suggested_fix: "validate a" };

describe("rejectedReview", () => {
  it("gives the findings of the review that rejected the staged diff", async () => {
    await saveVerdict(dir, git("diff --cached"), { verdict: "rejected", reviewer: "codex", issues: [issue] });
    const review = await rejectedReview({ projectDir: dir });
    expect(review).toMatchObject({ reviewer: "codex", count: 1 });
    expect(review.section).toMatch(/\[high\] a\.js:1: a is never validated\. Fix: validate a/);
  });

  it("refuses when the staged diff has no rejected review: approved, or none at all", async () => {
    await expect(rejectedReview({ projectDir: dir })).rejects.toThrow(/--retry.*kj review --staged/);
    await saveVerdict(dir, git("diff --cached"), { verdict: "approved", reviewer: "codex", issues: [] });
    await expect(rejectedReview({ projectDir: dir })).rejects.toThrow(/--retry/);
  });
});
