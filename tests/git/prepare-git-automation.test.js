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

// KJC-BUG-0412 (#2564): a resumed run keeps the baseline of the session it
// resumes; recomputed, the original run's own work counted as pending before.
describe("prepareGitAutomation baseline of pending changes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records on the session what was pending when it started", async () => {
    git.listPendingPaths.mockResolvedValueOnce(["notes.md"]);
    const session = { id: "s" };
    const ctx = await prepareGitAutomation({ config, task: "x", logger, session });
    expect(ctx.preexisting).toEqual(["notes.md"]);
    expect(session.git_preexisting).toEqual(["notes.md"]);
  });

  it("a resumed run keeps the baseline it is given instead of the tree's (KJC-BUG-0412)", async () => {
    const session = { id: "s" };
    const ctx = await prepareGitAutomation({ config, task: "x", logger, session, preexisting: ["notes.md"] });
    expect(ctx.preexisting).toEqual(["notes.md"]);
    expect(session.git_preexisting).toEqual(["notes.md"]);
    expect(git.listPendingPaths).not.toHaveBeenCalled();
  });

  // KJC-TSK-1237: the format stage needs the baseline also when kj does not commit.
  it("records the baseline when git automation is off (KJC-TSK-1237)", async () => {
    git.listPendingPaths.mockResolvedValueOnce(["notes.md"]);
    const session = { id: "s" };
    expect(await prepareGitAutomation({ config: { git: {} }, task: "x", logger, session })).toEqual({ enabled: false });
    expect(session.git_preexisting).toEqual(["notes.md"]);
  });

  it("outside git, with automation off, records no baseline and does not fail", async () => {
    git.listPendingPaths.mockRejectedValueOnce(new Error("not a git repository"));
    const session = { id: "s" };
    expect(await prepareGitAutomation({ config: { git: {} }, task: "x", logger, session })).toEqual({ enabled: false });
    expect(session.git_preexisting).toBeUndefined();
  });
});
