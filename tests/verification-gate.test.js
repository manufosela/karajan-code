import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit follow-up: verification-gate now uses execFileSync instead of
// execSync (no shell expansion of `baseRef` / `projectDir`). Tests mock
// execFileSync accordingly and assert on the arg-array shape.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

import { execFileSync } from "node:child_process";
const {
  countChangesSince, countUntrackedFiles, verifyCoderOutput, VerificationTracker
} = await import("../src/orchestrator/verification-gate.js");

describe("verification-gate", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("countChangesSince", () => {
    it("parses git diff --numstat output", () => {
      execFileSync.mockReturnValue("10\t5\tsrc/a.js\n3\t2\tsrc/b.js\n");
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(2);
      expect(result.linesAdded).toBe(13);
      expect(result.linesDeleted).toBe(7);
      expect(result.files).toEqual(["src/a.js", "src/b.js"]);
    });

    it("returns zeros on empty output", () => {
      execFileSync.mockReturnValue("");
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(0);
      expect(result.linesAdded).toBe(0);
    });

    it("surfaces git failures via `gitError` (no longer silently 0)", () => {
      execFileSync.mockImplementation(() => { throw new Error("not a git repo"); });
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(0);
      expect(result.files).toEqual([]);
      expect(result.gitError).toMatch(/not a git repo/);
    });

    it("includes projectDir scope in command (as a separate arg, post-`--`)", () => {
      execFileSync.mockReturnValue("");
      countChangesSince("abc123", "demo/");
      // execFileSync receives ("git", [args...], opts).
      // No shell expansion: each arg is its own array element.
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["diff", "--numstat", "abc123", "--", "demo/"]),
        expect.any(Object)
      );
    });
  });

  describe("countUntrackedFiles", () => {
    it("returns { files: [...] } with the untracked files", () => {
      execFileSync.mockReturnValue("new.js\nnew-dir/file.ts\n");
      const result = countUntrackedFiles();
      expect(result.files).toEqual(["new.js", "new-dir/file.ts"]);
      expect(result.gitError).toBeUndefined();
    });

    it("returns { files: [] } when there are no untracked files", () => {
      execFileSync.mockReturnValue("");
      expect(countUntrackedFiles()).toEqual({ files: [] });
    });

    it("surfaces git failures via `gitError` (no longer empty-array silent)", () => {
      execFileSync.mockImplementation(() => { throw new Error("fail"); });
      const result = countUntrackedFiles();
      expect(result.files).toEqual([]);
      expect(result.gitError).toMatch(/fail/);
    });
  });

  describe("verifyCoderOutput", () => {
    it("passes when files are changed", () => {
      execFileSync
        .mockReturnValueOnce("10\t5\tsrc/a.js\n")
        .mockReturnValueOnce("");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(true);
      expect(result.filesChanged).toBe(1);
      expect(result.linesChanged).toBe(15);
    });

    it("passes when only untracked files exist", () => {
      execFileSync
        .mockReturnValueOnce("")
        .mockReturnValueOnce("new.js\nother.js\n");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(true);
      expect(result.filesChanged).toBe(2);
    });

    it("fails when no changes at all", () => {
      execFileSync.mockReturnValue("");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("0 file changes");
      expect(result.retryStrategy).toContain("explicit file paths");
    });

    it("combines tracked + untracked files", () => {
      execFileSync
        .mockReturnValueOnce("5\t0\tsrc/existing.js\n")
        .mockReturnValueOnce("new.js\n");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.filesChanged).toBe(2);
      expect(result.files).toContain("src/existing.js");
      expect(result.files).toContain("new.js");
    });

    // Resilience audit, Phase 4: previously a git failure (bad
    // baseRef, corrupt repo, git missing) was indistinguishable from
    // "the coder did nothing", so the orchestrator wasted iterations
    // retrying the agent with "rephrase the feedback with explicit
    // file paths" when the real cause was infrastructure.
    it("when git itself fails, returns gitError and a null retryStrategy (no agent blame)", () => {
      execFileSync.mockImplementation(() => {
        throw new Error("fatal: bad revision 'HEAD~1'");
      });
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(false);
      expect(result.gitError).toMatch(/bad revision/);
      expect(result.reason).toMatch(/Git verification failed/);
      expect(result.retryStrategy).toBeNull();
    });
  });

  describe("VerificationTracker", () => {
    it("tracks consecutive failures", () => {
      const tracker = new VerificationTracker();
      tracker.record({ passed: false, filesChanged: 0 });
      tracker.record({ passed: false, filesChanged: 0 });
      expect(tracker.consecutiveFailures).toBe(2);
      expect(tracker.isStuck()).toBe(true);
    });

    it("resets on success", () => {
      const tracker = new VerificationTracker();
      tracker.record({ passed: false });
      tracker.record({ passed: true });
      expect(tracker.consecutiveFailures).toBe(0);
      expect(tracker.isStuck()).toBe(false);
    });

    it("returns last failure", () => {
      const tracker = new VerificationTracker();
      tracker.record({ passed: true });
      tracker.record({ passed: false, reason: "no changes" });
      const last = tracker.getLastFailure();
      expect(last.reason).toBe("no changes");
    });

    it("respects custom threshold", () => {
      const tracker = new VerificationTracker();
      tracker.record({ passed: false });
      expect(tracker.isStuck(1)).toBe(true);
      expect(tracker.isStuck(3)).toBe(false);
    });
  });
});
