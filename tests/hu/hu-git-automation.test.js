import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));
vi.mock("../src/utils/git.js", () => ({
  commitAll: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
  hasChanges: vi.fn(),
}));

const { buildHuBranchName, resolveHuBase, prepareHuBranch } = await import("../src/git/hu-automation.js");
const { runCommand } = await import("../src/utils/process.js");

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
