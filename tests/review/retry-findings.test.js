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

  // HU-4843 (KJC-TSK-1732, épica KJC-PCS-0113): the coder gets what holds as its task; what does not
  // anchor is named apart as unverified, so nobody writes code to fix a problem that is not there.
  it("hands the coder only the anchored findings; the unanchored ones go apart, marked unverified", async () => {
    const ghost = { id: "R-2", severity: "medium", file: "ghost.js", line: 3, description: "ghost leaks", suggested_fix: "x", reason: "missing-file" };
    await saveVerdict(dir, git("diff --cached"), { verdict: "rejected", reviewer: "codex", issues: [issue], unanchored: [ghost] });
    const review = await rejectedReview({ projectDir: dir });
    expect(review.count).toBe(1);
    const [task, unverified] = review.section.split(/^## Not verified/m);
    expect(task).toMatch(/a\.js:1: a is never validated/);
    expect(task).not.toMatch(/ghost/);
    expect(unverified).toMatch(/do not fix[\s\S]*ghost\.js:3: ghost leaks[\s\S]*missing-file/i);
  });

  it("a verdict whose findings all anchor has no Not verified section", async () => {
    await saveVerdict(dir, git("diff --cached"), { verdict: "rejected", reviewer: "codex", issues: [issue], unanchored: [] });
    const review = await rejectedReview({ projectDir: dir });
    expect(review.count).toBe(1);
    expect(review.section).not.toMatch(/Not verified/);
  });

  it("an older verdict without an unanchored field is anchored when the retry reads it", async () => {
    const ghost = { id: "R-2", severity: "medium", file: "ghost.js", line: 3, description: "ghost leaks", suggested_fix: "x" };
    await saveVerdict(dir, git("diff --cached"), { verdict: "rejected", reviewer: "codex", issues: [issue, ghost] });
    const review = await rejectedReview({ projectDir: dir });
    expect(review.count).toBe(1);
    const [task, unverified] = review.section.split(/^## Not verified/m);
    expect(task).not.toMatch(/ghost/);
    expect(unverified).toMatch(/ghost\.js:3[\s\S]*missing-file/);
  });

  it("a protected finding that does not anchor stays in the task, marked", async () => {
    const leak = { id: "R-3", severity: "high", category: "security", file: "a.js", line: 1, description: "token leak", suggested_fix: "drop it", unanchored: "snippet-mismatch" };
    await saveVerdict(dir, git("diff --cached"), { verdict: "rejected", reviewer: "codex", issues: [leak] });
    const review = await rejectedReview({ projectDir: dir });
    expect(review.count).toBe(1);
    expect(review.section).toMatch(/a\.js:1: token leak[^\n]*not anchored: snippet-mismatch/);
    expect(review.section).not.toMatch(/^## Not verified/m);
  });

  it("refuses when the staged diff has no rejected review: approved, or none at all", async () => {
    await expect(rejectedReview({ projectDir: dir })).rejects.toThrow(/--retry.*kj review --staged/);
    await saveVerdict(dir, git("diff --cached"), { verdict: "approved", reviewer: "codex", issues: [] });
    await expect(rejectedReview({ projectDir: dir })).rejects.toThrow(/--retry/);
  });
});
