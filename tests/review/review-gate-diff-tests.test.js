// HU-4870 (KJC-TSK-1761): runReviewGate runs the diff-tests gate on the review path; a red one
// is recorded and the reviewer is never called, a note reaches the reviewer inside the task.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const reviewMock = vi.fn();
const diffTestsMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));
vi.mock("../../src/review/diff-tests-gate.js", () => ({ diffTestsGate: (...a) => diffTestsMock(...a) }));
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: vi.fn(async ({ stagedFiles }) => ({ available: true, projectKey: "t", blocking: [], advisory: [], covered: stagedFiles, uncovered: [] })),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));

import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { seedRagLedger } from "./_seed-rag-ledger.js";
import { isolatedGitEnv } from "../_helpers/isolated-git.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-difftests-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { env: isolatedGitEnv() });
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "base\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "a.js"), "changed\n");
  fs.writeFileSync(path.join(dir, "a.test.js"), "test\n");
  git("add", "a.js", "a.test.js");
  seedRagLedger(dir, ["a.js", "a.test.js"]);
  process.chdir(dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
});

describe("review gate runs the diff's tests (HU-4870)", () => {
  it("a red test of the diff rejects without calling the reviewer, and exits 1", async () => {
    const rejection = { verdict: "rejected", reviewer: "diff-tests", issues: [{ severity: "high", description: "1 test file(s) of the diff fail with vitest: a.test.js" }] };
    diffTestsMock.mockResolvedValue({ rejection, note: null });
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    expect(diffTestsMock).toHaveBeenCalledWith({ projectDir: dir, liveFiles: ["a.js", "a.test.js"] });
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "diff-tests" });
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("a green run reaches the reviewer with its note inside the task", async () => {
    diffTestsMock.mockResolvedValue({ rejection: null, note: "1 test file(s) of the diff passed with vitest" });
    await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(reviewMock.mock.calls[0][0].task).toMatch(/passed with vitest/);
  });
});
