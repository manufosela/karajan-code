import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunCommand = vi.fn();
vi.mock("../src/utils/process.js", () => ({ runCommand: mockRunCommand }));

const { detectRepo, detectPrNumber } = await import("../src/ci/repo.js");

describe("ci/repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectRepo", () => {
    it("extracts owner/repo from HTTPS remote", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "https://github.com/manufosela/karajan-code.git\n",
        stderr: ""
      });

      const result = await detectRepo();
      expect(result).toBe("manufosela/karajan-code");
    });

    it("extracts owner/repo from SSH remote", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "git@github.com:manufosela/karajan-code.git\n",
        stderr: ""
      });

      const result = await detectRepo();
      expect(result).toBe("manufosela/karajan-code");
    });

    it("handles HTTPS remote without .git suffix", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "https://github.com/owner/repo\n",
        stderr: ""
      });

      const result = await detectRepo();
      expect(result).toBe("owner/repo");
    });

    it("handles SSH remote with custom alias", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "git@github.com-manufosela:manufosela/karajan-code.git\n",
        stderr: ""
      });

      const result = await detectRepo();
      expect(result).toBe("manufosela/karajan-code");
    });

    it("returns null if not a git repo", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository"
      });

      const result = await detectRepo();
      expect(result).toBeNull();
    });

    it("returns null if remote URL is not GitHub", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "https://gitlab.com/user/repo.git\n",
        stderr: ""
      });

      const result = await detectRepo();
      expect(result).toBeNull();
    });
  });

  describe("detectPrNumber", () => {
    it("extracts PR number from gh pr view", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "42\n",
        stderr: ""
      });

      const result = await detectPrNumber("my-branch");
      expect(result).toBe(42);
      expect(mockRunCommand).toHaveBeenCalledWith("gh", [
        "pr",
        "view",
        "my-branch",
        "--json",
        "number",
        "--jq",
        ".number"
      ]);
    });

    it("returns null if no PR exists for branch", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "no pull requests found"
      });

      const result = await detectPrNumber("no-pr-branch");
      expect(result).toBeNull();
    });

    it("returns null for empty stdout", async () => {
      mockRunCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: ""
      });

      const result = await detectPrNumber("branch");
      expect(result).toBeNull();
    });
  });
});
