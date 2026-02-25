import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

// Mock git utilities before importing CommiterRole
vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn(),
  currentBranch: vi.fn(),
  fetchBase: vi.fn(),
  syncBaseBranch: vi.fn(),
  ensureBranchUpToDateWithBase: vi.fn(),
  createBranch: vi.fn(),
  buildBranchName: vi.fn(),
  hasChanges: vi.fn(),
  commitAll: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
  revParse: vi.fn()
}));

const { CommiterRole } = await import("../src/roles/commiter-role.js");
const git = await import("../src/utils/git.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("CommiterRole", () => {
  let emitter;

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    // Defaults: we're in a git repo with changes
    git.ensureGitRepo.mockResolvedValue(true);
    git.hasChanges.mockResolvedValue(true);
    git.currentBranch.mockResolvedValue("feat/my-branch");
    git.commitAll.mockResolvedValue({ committed: true });
    git.pushBranch.mockResolvedValue(undefined);
    git.createPullRequest.mockResolvedValue("https://github.com/org/repo/pull/42");
    git.fetchBase.mockResolvedValue(undefined);
    git.ensureBranchUpToDateWithBase.mockResolvedValue({ upToDate: true, rebased: false });
    git.revParse.mockResolvedValue("abc1234");
  });

  it("extends BaseRole and has name 'commiter'", () => {
    const role = new CommiterRole({ config: {}, logger });
    expect(role.name).toBe("commiter");
  });

  it("requires init() before run()", async () => {
    const role = new CommiterRole({ config: {}, logger });
    await expect(role.run({})).rejects.toThrow("init() must be called before run()");
  });

  it("commits changes with conventional commit message", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({ task: "Add user authentication" });
    const output = await role.run({ task: "Add user authentication" });

    expect(output.ok).toBe(true);
    expect(git.commitAll).toHaveBeenCalled();
    const commitMsg = git.commitAll.mock.calls[0][0];
    expect(commitMsg.length).toBeLessThanOrEqual(72);
  });

  it("uses provided commitMessage from input", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({ task: "Fix login" });
    await role.run({ task: "Fix login", commitMessage: "fix: resolve login null pointer" });

    expect(git.commitAll).toHaveBeenCalledWith("fix: resolve login null pointer");
  });

  it("generates commit message from task when not provided", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({ task: "Add widget feature" });
    await role.run({ task: "Add widget feature" });

    const commitMsg = git.commitAll.mock.calls[0][0];
    expect(commitMsg).toMatch(/^feat: /);
    expect(commitMsg).toContain("Add widget feature");
  });

  it("pushes branch when push is true", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Add feature", push: true });

    expect(git.pushBranch).toHaveBeenCalledWith("feat/my-branch");
  });

  it("does NOT push branch when push is false", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Add feature", push: false });

    expect(git.pushBranch).not.toHaveBeenCalled();
  });

  it("creates PR when createPr is true", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    const output = await role.run({ task: "Add feature", push: true, createPr: true });

    expect(git.createPullRequest).toHaveBeenCalled();
    expect(output.result.prUrl).toBe("https://github.com/org/repo/pull/42");
  });

  it("does NOT create PR when createPr is false", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Add feature", push: true, createPr: false });

    expect(git.createPullRequest).not.toHaveBeenCalled();
  });

  it("returns ok=false when not in a git repo", async () => {
    git.ensureGitRepo.mockResolvedValue(false);

    const role = new CommiterRole({ config: {}, logger });
    await role.init({});
    const output = await role.run({ task: "Fix bug" });

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("git");
  });

  it("returns ok=true with committed=false when no changes", async () => {
    git.hasChanges.mockResolvedValue(false);

    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    const output = await role.run({ task: "No changes" });

    expect(output.ok).toBe(true);
    expect(output.result.committed).toBe(false);
    expect(git.commitAll).not.toHaveBeenCalled();
  });

  it("rebases before push when baseBranch configured", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Feature", push: true });

    expect(git.fetchBase).toHaveBeenCalledWith("main");
    expect(git.ensureBranchUpToDateWithBase).toHaveBeenCalled();
  });

  it("returns result with branch and commit hash", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    const output = await role.run({ task: "Add feature" });

    expect(output.ok).toBe(true);
    expect(output.result.branch).toBe("feat/my-branch");
    expect(output.result.commitHash).toBe("abc1234");
    expect(output.result.committed).toBe(true);
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new CommiterRole({ config: { base_branch: "main" }, logger, emitter });
    await role.init({ task: "Task", iteration: 1 });
    await role.run({ task: "Task" });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("commiter");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when git operation fails", async () => {
    git.commitAll.mockRejectedValue(new Error("git commit failed: merge conflict"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new CommiterRole({ config: { base_branch: "main" }, logger, emitter });
    await role.init({ task: "Task" });
    await expect(role.run({ task: "Task" })).rejects.toThrow("git commit failed");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("git commit failed");
  });

  it("report() returns structured commiter report", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Build feature" });

    const report = role.report();
    expect(report.role).toBe("commiter");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
  });

  it("truncates long commit messages to 72 chars", async () => {
    const longTask = "A".repeat(100);
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: longTask });

    const commitMsg = git.commitAll.mock.calls[0][0];
    expect(commitMsg.length).toBeLessThanOrEqual(72);
  });

  it("PR title and body are generated from task", async () => {
    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await role.run({ task: "Add user profile page", push: true, createPr: true });

    const prCall = git.createPullRequest.mock.calls[0][0];
    expect(prCall.title).toContain("Add user profile page");
    expect(prCall.baseBranch).toBe("main");
    expect(prCall.branch).toBe("feat/my-branch");
    expect(prCall.body).toBeTruthy();
  });

  it("handles push failure gracefully", async () => {
    git.pushBranch.mockRejectedValue(new Error("push rejected: non-fast-forward"));

    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await expect(role.run({ task: "Feature", push: true })).rejects.toThrow("push rejected");
  });

  it("handles PR creation failure gracefully", async () => {
    git.createPullRequest.mockRejectedValue(new Error("gh: not found"));

    const role = new CommiterRole({ config: { base_branch: "main" }, logger });
    await role.init({});
    await expect(role.run({ task: "Feature", push: true, createPr: true })).rejects.toThrow("gh: not found");
  });
});
