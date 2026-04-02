import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const { computeBaseRef, generateDiff, getUntrackedFiles } = await import("../src/review/diff-generator.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeBaseRef", () => {
  it("returns explicit baseRef when provided", async () => {
    const ref = await computeBaseRef({ baseRef: "abc123" });
    expect(ref).toBe("abc123");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns merge-base when available", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "def456\n", stderr: "" });
    const ref = await computeBaseRef({ baseBranch: "main" });
    expect(ref).toBe("def456");
    expect(runCommand).toHaveBeenCalledWith("git", ["merge-base", "HEAD", "origin/main"]);
  });

  it("falls back to HEAD~1 when merge-base fails", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "not a git repo" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "aaa111\n", stderr: "" });
    const ref = await computeBaseRef({ baseBranch: "main" });
    expect(ref).toBe("aaa111");
    expect(runCommand).toHaveBeenCalledWith("git", ["rev-parse", "HEAD~1"]);
  });

  it("returns empty tree hash when repo has zero commits", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "merge-base fail" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "HEAD~1 fail" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "4b825dc642cb6eb9a060e54bf899d15363da7461\n", stderr: "" });
    const ref = await computeBaseRef({ baseBranch: "main" });
    expect(ref).toBe("4b825dc642cb6eb9a060e54bf899d15363da7461");
    expect(runCommand).toHaveBeenCalledWith("git", ["hash-object", "-t", "tree", "/dev/null"]);
  });

  it("throws when all strategies fail", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "merge-base fail" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "HEAD~1 fail" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "hash-object fail" });
    await expect(computeBaseRef({ baseBranch: "main" })).rejects.toThrow("Could not compute diff base reference");
  });
});

describe("generateDiff", () => {
  it("builds diff against base ref including uncommitted workspace changes", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "diff --git ...", stderr: "" });

    await generateDiff({ baseRef: "abc123" });

    expect(runCommand).toHaveBeenCalledWith("git", ["diff", "abc123"]);
  });
});

describe("getUntrackedFiles", () => {
  it("returns list of untracked files excluding gitignored", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "src/guards/policy-resolver.js\ntests/guards/policy-resolver.test.js\n",
      stderr: ""
    });

    const files = await getUntrackedFiles();

    expect(runCommand).toHaveBeenCalledWith("git", ["ls-files", "--others", "--exclude-standard"]);
    expect(files).toEqual([
      "src/guards/policy-resolver.js",
      "tests/guards/policy-resolver.test.js"
    ]);
  });

  it("returns empty array when no untracked files", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const files = await getUntrackedFiles();

    expect(files).toEqual([]);
  });

  it("returns empty array when command fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });

    const files = await getUntrackedFiles();

    expect(files).toEqual([]);
  });
});
