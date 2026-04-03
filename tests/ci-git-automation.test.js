import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn()
}));

const mockCommitAll = vi.fn();
const mockPushBranch = vi.fn();
const mockCreatePullRequest = vi.fn();

vi.mock("../src/utils/git.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    commitAll: (...args) => mockCommitAll(...args),
    pushBranch: (...args) => mockPushBranch(...args),
    createPullRequest: (...args) => mockCreatePullRequest(...args)
  };
});

const { earlyPrCreation, incrementalPush } = await import("../src/git/automation.js");

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn() });
const makeSession = () => ({ id: "s_test", checkpoints: [] });
const makeGitCtx = () => ({ enabled: true, branch: "feat/test", baseBranch: "main", autoRebase: true });

describe("earlyPrCreation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits, pushes, and creates PR returning prNumber", async () => {
    mockCommitAll.mockResolvedValue({
      committed: true,
      commit: { hash: "abc123", message: "feat: test task" }
    });
    mockPushBranch.mockResolvedValue();
    mockCreatePullRequest.mockResolvedValue("https://github.com/owner/repo/pull/42");

    const result = await earlyPrCreation({
      gitCtx: makeGitCtx(),
      task: "test task",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toEqual({
      prNumber: 42,
      prUrl: "https://github.com/owner/repo/pull/42",
      commits: [{ hash: "abc123", message: "feat: test task" }]
    });

    expect(mockCommitAll).toHaveBeenCalledOnce();
    expect(mockPushBranch).toHaveBeenCalledWith("feat/test");
    expect(mockCreatePullRequest).toHaveBeenCalledOnce();
  });

  it("returns null when nothing to commit", async () => {
    mockCommitAll.mockResolvedValue({ committed: false });

    const result = await earlyPrCreation({
      gitCtx: makeGitCtx(),
      task: "test",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toBeNull();
    expect(mockPushBranch).not.toHaveBeenCalled();
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it("returns null when git is disabled", async () => {
    const result = await earlyPrCreation({
      gitCtx: { enabled: false },
      task: "test",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toBeNull();
  });
});

describe("incrementalPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits and pushes without creating PR", async () => {
    mockCommitAll.mockResolvedValue({
      committed: true,
      commit: { hash: "def456", message: "feat: fix" }
    });
    mockPushBranch.mockResolvedValue();

    const result = await incrementalPush({
      gitCtx: makeGitCtx(),
      task: "fix thing",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toEqual({
      commits: [{ hash: "def456", message: "feat: fix" }]
    });
    expect(mockPushBranch).toHaveBeenCalledWith("feat/test");
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it("returns null when nothing to commit", async () => {
    mockCommitAll.mockResolvedValue({ committed: false });

    const result = await incrementalPush({
      gitCtx: makeGitCtx(),
      task: "test",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toBeNull();
    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  it("returns null when git is disabled", async () => {
    const result = await incrementalPush({
      gitCtx: { enabled: false },
      task: "test",
      logger: makeLogger(),
      session: makeSession()
    });

    expect(result).toBeNull();
  });
});
