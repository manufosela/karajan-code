import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const { computeBaseRef, generateDiff } = await import("../src/review/diff-generator.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeBaseRef", () => {
  it("calculates merge-base correctly", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "abc123\n", stderr: "" });

    const result = await computeBaseRef({ baseBranch: "develop", baseRef: null });

    expect(result).toBe("abc123");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith("git", ["merge-base", "HEAD", "origin/develop"]);
  });

  it("falls back to HEAD~1 when merge-base fails", async () => {
    runCommand.mockImplementation((cmd, args) => {
      if (cmd === "git" && args[0] === "merge-base") {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "fatal" });
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return Promise.resolve({ exitCode: 0, stdout: "def456\n", stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    });

    const result = await computeBaseRef({ baseBranch: "main", baseRef: null });

    expect(result).toBe("def456");
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, "git", ["merge-base", "HEAD", "origin/main"]);
    expect(runCommand).toHaveBeenNthCalledWith(2, "git", ["rev-parse", "HEAD~1"]);
  });

  it("throws when merge-base and fallback both fail", async () => {
    runCommand.mockImplementation((cmd, args) => {
      if (cmd === "git" && args[0] === "merge-base") {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "fatal" });
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "fatal" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    });

    await expect(computeBaseRef({ baseBranch: "bad", baseRef: null })).rejects.toThrow(
      "Could not compute diff base reference"
    );

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, "git", ["merge-base", "HEAD", "origin/bad"]);
    expect(runCommand).toHaveBeenNthCalledWith(2, "git", ["rev-parse", "HEAD~1"]);
  });
});

describe("generateDiff", () => {
  it("generates diff between baseRef..HEAD", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "diff --git a b", stderr: "" });

    const result = await generateDiff({ baseRef: "abc123" });

    expect(result).toBe("diff --git a b");
    expect(runCommand).toHaveBeenCalledWith("git", ["diff", "abc123..HEAD"]);
  });

  it("returns empty string when no changes exist", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const result = await generateDiff({ baseRef: "abc123" });

    expect(result).toBe("");
  });

  it("throws an error for invalid branch names", async () => {
    runCommand.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: ambiguous argument 'bad..HEAD': unknown revision"
    });

    await expect(generateDiff({ baseRef: "bad" })).rejects.toThrow(
      "git diff failed: fatal: ambiguous argument 'bad..HEAD': unknown revision"
    );
  });
});
