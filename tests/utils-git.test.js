import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

describe("utils/git", () => {
  let git, runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    const processMod = await import("../src/utils/process.js");
    runCommand = processMod.runCommand;
    git = await import("../src/utils/git.js");
  });

  describe("ensureGitRepo", () => {
    it("returns true inside a git repo", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "true\n", stderr: "" });

      expect(await git.ensureGitRepo()).toBe(true);
      expect(runCommand).toHaveBeenCalledWith("git", ["rev-parse", "--is-inside-work-tree"]);
    });

    it("returns false outside a git repo", async () => {
      runCommand.mockResolvedValue({ exitCode: 128, stdout: "", stderr: "not a git repo" });

      expect(await git.ensureGitRepo()).toBe(false);
    });
  });

  describe("currentBranch", () => {
    it("returns the current branch name", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "feat/test\n", stderr: "" });

      expect(await git.currentBranch()).toBe("feat/test");
    });

    it("throws on git failure", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });

      await expect(git.currentBranch()).rejects.toThrow("git rev-parse");
    });
  });

  describe("fetchBase", () => {
    it("fetches the base branch from origin", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      await git.fetchBase("main");
      expect(runCommand).toHaveBeenCalledWith("git", ["fetch", "origin", "main"], expect.anything());
    });
  });

  describe("buildBranchName", () => {
    it("builds a branch name from prefix and task", () => {
      const name = git.buildBranchName("feat/", "Add login feature");

      expect(name).toMatch(/^feat\/add-login-feature-/);
      // Contains ISO timestamp portion
      expect(name).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/);
    });

    it("slugifies special characters", () => {
      const name = git.buildBranchName("fix/", "Bug #42: fix & deploy!");

      expect(name).toMatch(/^fix\/bug-42-fix-deploy-/);
    });

    it("uses 'task' fallback for empty task", () => {
      const name = git.buildBranchName("feat/", "");

      expect(name).toMatch(/^feat\/task-/);
    });

    it("truncates long task slugs to 40 chars", () => {
      const longTask = "a".repeat(100);
      const name = git.buildBranchName("feat/", longTask);
      const slug = name.replace(/^feat\//, "").replace(/-\d{4}.*$/, "");

      expect(slug.length).toBeLessThanOrEqual(40);
    });
  });

  describe("hasChanges", () => {
    it("returns true when there are changes", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "M file.js\n", stderr: "" });

      expect(await git.hasChanges()).toBe(true);
    });

    it("returns false when clean", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      expect(await git.hasChanges()).toBe(false);
    });
  });

  describe("commitAll", () => {
    it("stages and commits when there are changes", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })  // git add -A
        .mockResolvedValueOnce({ exitCode: 0, stdout: "M file.js", stderr: "" })  // git status --porcelain
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });  // git commit

      const result = await git.commitAll("test commit");

      expect(result.committed).toBe(true);
      expect(runCommand).toHaveBeenCalledWith("git", ["add", "-A"], expect.anything());
      expect(runCommand).toHaveBeenCalledWith("git", ["commit", "-m", "test commit"], expect.anything());
    });

    it("skips commit when no changes after staging", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })  // git add -A
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });  // git status --porcelain (empty)

      const result = await git.commitAll("test commit");

      expect(result.committed).toBe(false);
    });
  });

  describe("pushBranch", () => {
    it("pushes branch to origin with -u flag", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      await git.pushBranch("feat/test");
      expect(runCommand).toHaveBeenCalledWith("git", ["push", "-u", "origin", "feat/test"], expect.anything());
    });
  });

  describe("createPullRequest", () => {
    it("creates PR via gh CLI", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "https://github.com/repo/pull/1\n", stderr: "" });

      const url = await git.createPullRequest({
        baseBranch: "main",
        branch: "feat/test",
        title: "Test PR",
        body: "Description"
      });

      expect(url).toBe("https://github.com/repo/pull/1");
      expect(runCommand).toHaveBeenCalledWith(
        "gh",
        ["pr", "create", "--base", "main", "--head", "feat/test", "--title", "Test PR", "--body", "Description"]
      );
    });

    it("throws on gh failure", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "auth error" });

      await expect(
        git.createPullRequest({ baseBranch: "main", branch: "feat/test", title: "T", body: "B" })
      ).rejects.toThrow("gh");
    });
  });

  describe("syncBaseBranch", () => {
    it("returns synced=true, rebased=false when already in sync", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "abc123\n", stderr: "" });

      const result = await git.syncBaseBranch({ baseBranch: "main", autoRebase: false });
      expect(result).toEqual({ synced: true, rebased: false });
    });

    it("rebases when behind and autoRebase=true", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })  // rev-parse main
        .mockResolvedValueOnce({ exitCode: 0, stdout: "def456\n", stderr: "" })  // rev-parse origin/main
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });  // rebase

      const result = await git.syncBaseBranch({ baseBranch: "main", autoRebase: true });
      expect(result).toEqual({ synced: true, rebased: true });
    });

    it("throws when behind and autoRebase=false", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "def456\n", stderr: "" });

      await expect(git.syncBaseBranch({ baseBranch: "main", autoRebase: false })).rejects.toThrow("behind");
    });
  });
});
