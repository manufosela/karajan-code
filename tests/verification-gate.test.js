import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

import { execSync } from "node:child_process";
const {
  countChangesSince, countUntrackedFiles, verifyCoderOutput, VerificationTracker
} = await import("../src/orchestrator/verification-gate.js");

describe("verification-gate", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("countChangesSince", () => {
    it("parses git diff --numstat output", () => {
      execSync.mockReturnValue("10\t5\tsrc/a.js\n3\t2\tsrc/b.js\n");
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(2);
      expect(result.linesAdded).toBe(13);
      expect(result.linesDeleted).toBe(7);
      expect(result.files).toEqual(["src/a.js", "src/b.js"]);
    });

    it("returns zeros on empty output", () => {
      execSync.mockReturnValue("");
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(0);
      expect(result.linesAdded).toBe(0);
    });

    it("returns zeros on git error", () => {
      execSync.mockImplementation(() => { throw new Error("not a git repo"); });
      const result = countChangesSince("HEAD~1");
      expect(result.filesChanged).toBe(0);
      expect(result.files).toEqual([]);
    });

    it("includes projectDir scope in command", () => {
      execSync.mockReturnValue("");
      countChangesSince("abc123", "demo/");
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("-- demo/"),
        expect.any(Object)
      );
    });
  });

  describe("countUntrackedFiles", () => {
    it("returns list of untracked files", () => {
      execSync.mockReturnValue("new.js\nnew-dir/file.ts\n");
      const files = countUntrackedFiles();
      expect(files).toEqual(["new.js", "new-dir/file.ts"]);
    });

    it("returns empty array on no untracked", () => {
      execSync.mockReturnValue("");
      expect(countUntrackedFiles()).toEqual([]);
    });

    it("returns empty array on error", () => {
      execSync.mockImplementation(() => { throw new Error("fail"); });
      expect(countUntrackedFiles()).toEqual([]);
    });
  });

  describe("verifyCoderOutput", () => {
    it("passes when files are changed", () => {
      execSync
        .mockReturnValueOnce("10\t5\tsrc/a.js\n")
        .mockReturnValueOnce("");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(true);
      expect(result.filesChanged).toBe(1);
      expect(result.linesChanged).toBe(15);
    });

    it("passes when only untracked files exist", () => {
      execSync
        .mockReturnValueOnce("")
        .mockReturnValueOnce("new.js\nother.js\n");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(true);
      expect(result.filesChanged).toBe(2);
    });

    it("fails when no changes at all", () => {
      execSync.mockReturnValue("");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("0 file changes");
      expect(result.retryStrategy).toContain("explicit file paths");
    });

    it("combines tracked + untracked files", () => {
      execSync
        .mockReturnValueOnce("5\t0\tsrc/existing.js\n")
        .mockReturnValueOnce("new.js\n");
      const result = verifyCoderOutput({ baseRef: "HEAD~1" });
      expect(result.filesChanged).toBe(2);
      expect(result.files).toContain("src/existing.js");
      expect(result.files).toContain("new.js");
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
