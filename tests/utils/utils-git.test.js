import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

describe("utils/git", () => {
  let git, runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    const processMod = await import("../../src/utils/process.js");
    runCommand = processMod.runCommand;
    git = await import("../../src/utils/git.js");
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

  // Regression for N4 (2026-05-07 dogfooding): commitAll was throwing
  // "nada para hacer commit" when the working tree was clean by the
  // time `git commit` ran, even though `hasChanges()` had reported a
  // change moments earlier. The error escalated to Solomon and aborted
  // the post-loop journal writer (no summary.md / iterations.md). The
  // fix swallows the locale-specific "nothing to commit" message and
  // returns `committed: false` cleanly.
  describe("commitAll — race tolerance", () => {
    it("returns committed: false when git commit refuses with English 'nothing to commit'", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })            // git add -A
        .mockResolvedValueOnce({ exitCode: 0, stdout: " M file.js\n", stderr: "" }) // git status --porcelain → has changes
        .mockResolvedValueOnce({ exitCode: 1, stdout: "nothing to commit, working tree clean\n", stderr: "" }); // git commit fails

      const result = await git.commitAll("test commit");
      expect(result).toEqual({ committed: false });
    });

    it("returns committed: false on Spanish 'nada para hacer commit'", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: " M file.js\n", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "nada para hacer commit, el árbol de trabajo está limpio\n" });

      const result = await git.commitAll("test commit");
      expect(result).toEqual({ committed: false });
    });

    it("re-throws on a real git error (not a 'nothing to commit' false alarm)", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: " M file.js\n", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "fatal: unable to write index\n" });

      await expect(git.commitAll("test commit")).rejects.toThrow(/unable to write index/);
    });
  });

  describe("commitAll", () => {
    it("stages and commits when there are changes", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })  // git add -A
        .mockResolvedValueOnce({ exitCode: 0, stdout: "M file.js", stderr: "" })  // git status --porcelain
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })  // git commit
        .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\x1ffeat: test commit", stderr: "" });  // git log -1

      const result = await git.commitAll("test commit");

      expect(result.committed).toBe(true);
      expect(result.commit).toEqual({ hash: "abc123", message: "feat: test commit" });
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
        ["pr", "create", "--base", "main", "--head", "feat/test", "--title", "Test PR", "--body", "Description"],
        {}
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

  // KJC fix(double-commit) — N3-1
  describe("listPendingPaths", () => {
    it("returns [] when working tree is clean", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
      const paths = await git.listPendingPaths();
      expect(paths).toEqual([]);
    });

    it("parses simple modified/added paths", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: " M src/foo.js\n?? new-file.txt\nA  staged.js\n",
        stderr: "",
      });
      const paths = await git.listPendingPaths();
      expect(paths).toEqual(["src/foo.js", "new-file.txt", "staged.js"]);
    });

    it("returns the post-rename path when git reports a rename", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "R  old/path.js -> new/path.js\n",
        stderr: "",
      });
      const paths = await git.listPendingPaths();
      expect(paths).toEqual(["new/path.js"]);
    });

    it("includes the .gitignore + .karajan/ scaffold when triage extends them", async () => {
      // This is the exact `git status --porcelain` shape that produced
      // the duplicate `feat: ...` commit reported in N3-1.
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: " M .gitignore\n?? .karajan/coder-rules.md\n?? .reviews/s_xx/summary.md\n",
        stderr: "",
      });
      const paths = await git.listPendingPaths();
      expect(paths).toEqual([
        ".gitignore",
        ".karajan/coder-rules.md",
        ".reviews/s_xx/summary.md",
      ]);
    });
  });

  // 2026-05-07 dogfooding fix: the post-loop summary was listing ONLY
  // `gitResult.commits` (the scaffold commit produced by the post-loop)
  // and forgetting the coder's own commits. listCommitsBetween() asks
  // git for the full range so every commit shows up.
  describe("listCommitsBetween", () => {
    it("returns [] when fromSha is missing or empty", async () => {
      expect(await git.listCommitsBetween()).toEqual([]);
      expect(await git.listCommitsBetween(null)).toEqual([]);
      expect(await git.listCommitsBetween("")).toEqual([]);
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("parses oldest-first hash<TAB>message lines", async () => {
      // git log --reverse → coder's commit first, scaffold last.
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout:
          "abc1234567890abcdef1234567890abcdef123456\tdocs: add JSDoc to index.js\n"
          + "def4567890abcdef1234567890abcdef12345678\tchore: scaffold karajan workspace\n",
        stderr: "",
      });
      const commits = await git.listCommitsBetween("a2516ec");
      expect(runCommand).toHaveBeenCalledWith(
        "git",
        ["log", "--reverse", "--format=%H%x09%s", "a2516ec..HEAD"],
      );
      expect(commits).toHaveLength(2);
      expect(commits[0]).toEqual({
        hash: "abc1234567890abcdef1234567890abcdef123456",
        message: "docs: add JSDoc to index.js",
      });
      expect(commits[1].message).toBe("chore: scaffold karajan workspace");
    });

    it("honours a custom toRef", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
      await git.listCommitsBetween("origin/main", "feat/foo");
      expect(runCommand).toHaveBeenCalledWith(
        "git",
        ["log", "--reverse", "--format=%H%x09%s", "origin/main..feat/foo"],
      );
    });

    it("returns [] on a non-zero git log exit (defensive — keep summary writable)", async () => {
      runCommand.mockResolvedValue({ exitCode: 128, stdout: "", stderr: "fatal: bad revision" });
      expect(await git.listCommitsBetween("nonexistent")).toEqual([]);
    });

    it("returns [] when runCommand throws (no exception leak)", async () => {
      runCommand.mockRejectedValue(new Error("git binary missing"));
      expect(await git.listCommitsBetween("a2516ec")).toEqual([]);
    });

    it("survives a malformed line (no tab) by treating it as hash with empty message", async () => {
      // Defensive: should never happen with --format=%H%x09%s, but if a
      // future format change emits a hash on its own line we don't want
      // to crash the summary writer.
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "abc1234567890abcdef1234567890abcdef123456\n",
        stderr: "",
      });
      const commits = await git.listCommitsBetween("a2516ec");
      expect(commits).toEqual([
        { hash: "abc1234567890abcdef1234567890abcdef123456", message: "" },
      ]);
    });

    it("filters empty trailing lines", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "abc1\tone\ndef2\ttwo\n\n\n",
        stderr: "",
      });
      const commits = await git.listCommitsBetween("a");
      expect(commits.map((c) => c.hash)).toEqual(["abc1", "def2"]);
    });
  });

  // KJC-TSK-0376 — used by the plan-adherence metric to score whether
  // the coder's file changes fall inside any HU's declared scope.
  describe("listFilesChangedSince", () => {
    it("returns [] on empty / missing fromSha", async () => {
      expect(await git.listFilesChangedSince()).toEqual([]);
      expect(await git.listFilesChangedSince(null)).toEqual([]);
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("invokes `git diff --name-only` and returns the unique paths", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "src/store.js\nsrc/routes/todos.js\npackage.json\n",
        stderr: "",
      });
      const files = await git.listFilesChangedSince("abc123");
      expect(runCommand).toHaveBeenCalledWith(
        "git",
        ["diff", "--name-only", "abc123..HEAD"],
      );
      expect(files).toEqual(["src/store.js", "src/routes/todos.js", "package.json"]);
    });

    it("dedupes when a file is listed more than once across the range", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "src/foo.js\nsrc/bar.js\nsrc/foo.js\n",
        stderr: "",
      });
      expect(await git.listFilesChangedSince("a")).toEqual(["src/foo.js", "src/bar.js"]);
    });

    it("returns [] on non-zero exit (defensive)", async () => {
      runCommand.mockResolvedValue({ exitCode: 128, stdout: "", stderr: "fatal: bad rev" });
      expect(await git.listFilesChangedSince("nope")).toEqual([]);
    });

    it("returns [] when runCommand throws", async () => {
      runCommand.mockRejectedValue(new Error("git not on PATH"));
      expect(await git.listFilesChangedSince("a")).toEqual([]);
    });
  });
});
