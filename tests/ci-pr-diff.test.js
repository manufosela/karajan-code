import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunCommand = vi.fn();
vi.mock("../src/utils/process.js", () => ({ runCommand: mockRunCommand }));

const { getPrDiff } = await import("../src/ci/pr-diff.js");

describe("ci/pr-diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns diff from gh pr diff", async () => {
    const fakeDiff = "diff --git a/foo.js b/foo.js\n+added line\n";
    mockRunCommand.mockResolvedValue({
      exitCode: 0,
      stdout: fakeDiff,
      stderr: ""
    });

    const result = await getPrDiff(42);
    expect(result).toBe(fakeDiff);
    expect(mockRunCommand).toHaveBeenCalledWith("gh", ["pr", "diff", "42"]);
  });

  it("throws if prNumber is missing", async () => {
    await expect(getPrDiff(null)).rejects.toThrow(/prNumber.*required/i);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("throws on gh failure", async () => {
    mockRunCommand.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "no pull request found"
    });

    await expect(getPrDiff(99)).rejects.toThrow(/gh pr diff 99 failed/);
  });
});
