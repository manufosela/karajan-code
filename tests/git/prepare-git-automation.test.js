// KJC-BUG-0249 (#1896): with a Planning Game card the run's branch is named
// after it, and a second run of the same card takes the branch already there.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/session/store.js", () => ({ addCheckpoint: vi.fn() }));
vi.mock("../../src/git/run-identity.js", () => ({ resolveRunIdentity: () => null, identityEnv: () => ({}) }));

const git = {
  ensureGitRepo: vi.fn(async () => true),
  currentBranch: vi.fn(async () => "main"),
  hasCommits: vi.fn(async () => true),
  fetchBase: vi.fn(async () => {}),
  syncBaseBranch: vi.fn(async () => {}),
  ensureBranchUpToDateWithBase: vi.fn(async () => {}),
  createBranch: vi.fn(async () => {}),
  checkoutBranch: vi.fn(async () => {}),
  listPendingPaths: vi.fn(async () => []),
  hasRemote: vi.fn(async () => false),
};
vi.mock("../../src/utils/git.js", async (importOriginal) => ({ ...(await importOriginal()), ...git }));

const { prepareGitAutomation } = await import("../../src/git/automation.js");
const config = { git: { auto_commit: true }, base_branch: "main" };
const logger = { info: vi.fn(), warn: vi.fn() };

describe("prepareGitAutomation with a Planning Game card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the branch after the card", async () => {
    const ctx = await prepareGitAutomation({ config, task: "Google login", logger, session: { id: "s", pg_task_id: "CUL-TSK-0001" } });
    expect(ctx.branch).toBe("feat/CUL-TSK-0001-google-login");
    expect(git.createBranch).toHaveBeenCalledWith("feat/CUL-TSK-0001-google-login");
  });

  it("a second run of the card takes its branch instead of failing to create it", async () => {
    git.createBranch.mockRejectedValueOnce(new Error("git checkout -b feat/CUL-TSK-0001-google-login failed: fatal: a branch named 'feat/CUL-TSK-0001-google-login' already exists"));
    const ctx = await prepareGitAutomation({ config, task: "Google login", logger, session: { id: "s", pg_task_id: "CUL-TSK-0001" } });
    expect(ctx.branch).toBe("feat/CUL-TSK-0001-google-login");
    expect(git.checkoutBranch).toHaveBeenCalledWith("feat/CUL-TSK-0001-google-login");
  });

  it("any other failure to create the branch still stops the run", async () => {
    git.createBranch.mockRejectedValueOnce(new Error("git checkout -b x failed: fatal: not a git repository"));
    await expect(prepareGitAutomation({ config, task: "x", logger, session: { id: "s", pg_task_id: "CUL-TSK-0001" } })).rejects.toThrow(/not a git repository/);
  });

  it("already on the card's branch, keeps it", async () => {
    git.currentBranch.mockResolvedValueOnce("feat/CUL-TSK-0001-scaffold");
    const ctx = await prepareGitAutomation({ config, task: "x", logger, session: { id: "s", pg_task_id: "CUL-TSK-0001" } });
    expect(ctx.branch).toBe("feat/CUL-TSK-0001-scaffold");
    expect(git.createBranch).not.toHaveBeenCalled();
  });
});
