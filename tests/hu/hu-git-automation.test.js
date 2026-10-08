import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));
vi.mock("../../src/utils/git.js", () => ({
  commitAll: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
  hasChanges: vi.fn(),
}));

const { buildHuBranchName, resolveHuBase, prepareHuBranch, finalizeHuCommit, collectGitWarnings } = await import("../../src/git/hu-automation.js");
const { runCommand } = await import("../../src/utils/process.js");
const { hasChanges, commitAll, pushBranch, createPullRequest } = await import("../../src/utils/git.js");

describe("buildHuBranchName", () => {
  it("builds branch name with prefix, id and slug", () => {
    const story = { id: "HU-01", title: "Setup project infrastructure" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-01-setup-project-infrastructure");
  });

  it("slugifies special chars", () => {
    const story = { id: "HU-02", title: "Auth & User CRUD (v2)" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-02-auth-user-crud-v2");
  });

  it("truncates long titles", () => {
    const story = { id: "HU-03", title: "a".repeat(100) };
    const name = buildHuBranchName("feat/", story);
    expect(name.length).toBeLessThanOrEqual("feat/HU-03-".length + 40);
  });

  it("falls back to id when no title", () => {
    const story = { id: "HU-04" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-04-hu-04");
  });

  it("respects custom prefix", () => {
    const story = { id: "HU-05", title: "Fix bug" };
    expect(buildHuBranchName("chore/hu/", story)).toBe("chore/hu/HU-05-fix-bug");
  });
});

describe("resolveHuBase", () => {
  it("returns baseBranch for HU with no dependencies", () => {
    const story = { id: "HU-01", blocked_by: [] };
    const branches = new Map();
    expect(resolveHuBase(story, branches, "main")).toBe("main");
  });

  it("returns parent branch when HU depends on another HU", () => {
    const story = { id: "HU-02", blocked_by: ["HU-01"] };
    const branches = new Map([["HU-01", "feat/HU-01-setup"]]);
    expect(resolveHuBase(story, branches, "main")).toBe("feat/HU-01-setup");
  });

  it("returns last parent when multiple parents exist", () => {
    const story = { id: "HU-03", blocked_by: ["HU-01", "HU-02"] };
    const branches = new Map([
      ["HU-01", "feat/HU-01-setup"],
      ["HU-02", "feat/HU-02-auth"]
    ]);
    expect(resolveHuBase(story, branches, "main")).toBe("feat/HU-02-auth");
  });

  it("falls back to baseBranch when parent branches not yet created", () => {
    const story = { id: "HU-02", blocked_by: ["HU-01"] };
    const branches = new Map();
    expect(resolveHuBase(story, branches, "main")).toBe("main");
  });
});

// N6 dogfooding 2026-05-07: `git init -q` + init.defaultBranch=master
// produced 7 identical "branch 'main' is not a commit" warnings — every
// HU silently fell back to the original branch and the per-HU isolation
// the sub-pipeline was designed to provide was lost.
describe("prepareHuBranch — base-branch fallback (N6 dogfooding)", () => {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const baseConfig = { git: { auto_commit: true, branch_prefix: "feat/" }, base_branch: "main" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the configured base_branch when it exists locally", async () => {
    runCommand
      // resolveExistingBranchRef: probe `main` → exists.
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })
      // checkout -B feat/HU-01-... main → ok.
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    const story = { id: "HU-01", title: "Setup", blocked_by: [] };
    const huBranches = new Map();
    const branch = await prepareHuBranch({ story, huBranches, config: baseConfig, logger });

    expect(branch).toBe("feat/HU-01-setup");
    expect(runCommand).toHaveBeenNthCalledWith(1, "git", ["rev-parse", "--verify", "--quiet", "main"], {});
    expect(runCommand).toHaveBeenNthCalledWith(2, "git", ["checkout", "-B", "feat/HU-01-setup", "main"], {});
    expect(huBranches.get("HU-01")).toBe("feat/HU-01-setup");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to 'master' when 'main' does not exist", async () => {
    // Candidate order after dedup: main, master, HEAD. Probe in order;
    // first match wins.
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "fatal: Needed a single revision" }) // main missing
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })  // master exists → win
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });          // checkout -B ... master

    const story = { id: "HU-01", title: "Setup", blocked_by: [] };
    const huBranches = new Map();
    const branch = await prepareHuBranch({ story, huBranches, config: baseConfig, logger });

    expect(branch).toBe("feat/HU-01-setup");
    // Last checkout call should branch from master, not main
    const checkoutCall = runCommand.mock.calls.find(c => c[0] === "git" && c[1][0] === "checkout");
    expect(checkoutCall[1]).toEqual(["checkout", "-B", "feat/HU-01-setup", "master"]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/configured base 'main' not found locally — using 'master'/));
  });

  it("falls back to HEAD when neither 'main' nor 'master' exist", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // main missing
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // master missing
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" }) // HEAD exists
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });        // checkout

    const story = { id: "HU-01", title: "Setup", blocked_by: [] };
    const branch = await prepareHuBranch({ story, huBranches: new Map(), config: baseConfig, logger });

    expect(branch).toBe("feat/HU-01-setup");
    const checkoutCall = runCommand.mock.calls.find(c => c[0] === "git" && c[1][0] === "checkout");
    expect(checkoutCall[1]).toEqual(["checkout", "-B", "feat/HU-01-setup", "HEAD"]);
  });

  it("returns null and warns when checkout still fails after fallback", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // main missing
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // master missing
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" }) // HEAD missing (zero-commits)
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "fatal: empty repo" }); // checkout fails

    const story = { id: "HU-01", title: "Setup", blocked_by: [] };
    const branch = await prepareHuBranch({ story, huBranches: new Map(), config: baseConfig, logger });

    expect(branch).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/HU git: failed to create branch/));
  });

  it("noop returns null when no git automation flags are set", async () => {
    const config = { git: { auto_commit: false, auto_push: false, auto_pr: false }, base_branch: "main" };
    const branch = await prepareHuBranch({ story: { id: "HU-01" }, huBranches: new Map(), config, logger });
    expect(branch).toBeNull();
    expect(runCommand).not.toHaveBeenCalled();
  });
});

// KJC-BUG-0248 (#1895): with auto_push and auto_pr on, a push or a PR that
// failed was one warn line; the run then said approved with no push and no
// PR. The failure travels in the result, with its remedy.
describe("finalizeHuCommit says what failed (KJC-BUG-0248)", () => {
  const config = { git: { auto_commit: true, auto_push: true, auto_pr: true }, base_branch: "main" };
  const story = { id: "HU-01", title: "scaffold" };
  const logger = { info: vi.fn(), warn: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    hasChanges.mockResolvedValue(true);
    commitAll.mockResolvedValue({ hash: "abc1234" });
  });

  it("a push refused for the workflow scope names the scope and its remedy, and no PR is tried", async () => {
    pushBranch.mockRejectedValue(new Error("git push failed: ! [remote rejected] (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)"));
    const r = await finalizeHuCommit({ story, branchName: "feat/HU-01-scaffold", config, logger });
    expect(r).toMatchObject({ committed: true, pushed: false, prUrl: null, branch: "feat/HU-01-scaffold" });
    expect(r.errors).toEqual([expect.objectContaining({ step: "push", message: expect.stringMatching(/workflow/) })]);
    expect(r.errors[0].remedy).toMatch(/gh auth refresh -h github.com -s workflow/);
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("a PR that fails after the push travels too", async () => {
    pushBranch.mockResolvedValue(undefined);
    createPullRequest.mockRejectedValue(new Error("gh pr create failed: no commits between main and feat/HU-01-scaffold"));
    const r = await finalizeHuCommit({ story, branchName: "feat/HU-01-scaffold", config, logger });
    expect(r.pushed).toBe(true);
    expect(r.errors).toEqual([expect.objectContaining({ step: "pr", message: expect.stringMatching(/no commits between/) })]);
    expect(r.errors[0].remedy).toMatch(/gh pr create --base main --head feat\/HU-01-scaffold/);
  });

  it("collectGitWarnings names the HU, the step, the message and the remedy", () => {
    const results = [
      { huId: "HU-01", result: { git: { errors: [{ step: "push", message: "refused", remedy: "push it yourself" }] } } },
      { huId: "HU-02", result: { git: { errors: [] } } },
      { huId: "HU-03", result: {} },
    ];
    expect(collectGitWarnings(results)).toEqual(["HU-01: push failed: refused. push it yourself"]);
  });
});
