// PAR-E2 (KJC-TSK-0629) PR2: per-HU adjustments live on LANE copies —
// the shared ctx (config, pipelineFlags, session, brainCtx) must come out
// of a lane byte-identical, and worktree lanes must hand the coder a
// lane-scoped config + cloned session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const runCoderStageMock = vi.fn(async () => ({ ok: true }));
const prepareHuBranchMock = vi.fn(async () => "feat/branch");
const finalizeHuCommitMock = vi.fn(async () => ({ committed: true, pushed: false, prUrl: null }));

vi.mock("../src/orchestrator/hu-sub-pipeline.js", () => ({
  needsSubPipeline: () => true,
  runHuSubPipeline: vi.fn(async ({ runIterationFn }) => {
    const story = {
      id: "HU-1", task_type: "sw", status: "certified",
      certified: { title: "T" }, acceptance_tests: ["test -f x"]
    };
    const res = await runIterationFn("do x", story, { worktreePath: "/proj/.kj/worktrees/HU-1" });
    return { approved: res.approved, results: [res], blockedIds: [] };
  })
}));
vi.mock("../src/orchestrator/stages/coder-stage.js", () => ({
  runCoderStage: (...args) => runCoderStageMock(...args)
}));
vi.mock("../src/orchestrator/stages/sonar-stage.js", () => ({ runSonarStage: vi.fn() }));
vi.mock("../src/orchestrator/drivers/iteration-loop.js", () => ({ runIterationLoop: vi.fn() }));
vi.mock("../src/orchestrator/drivers/post-loop.js", () => ({ writeHistoryRecord: vi.fn() }));
vi.mock("../src/git/hu-snapshot.js", () => ({ createHuSnapshot: vi.fn(async () => ({ ok: false, error: "skip" })) }));
vi.mock("../src/git/hu-automation.js", () => ({
  prepareHuBranch: (...args) => prepareHuBranchMock(...args),
  finalizeHuCommit: (...args) => finalizeHuCommitMock(...args)
}));
vi.mock("../src/guards/policy-resolver.js", () => ({
  effectiveTaskType: () => "sw",
  applyPolicies: () => ({ reviewer: false, tdd: false, sonar: false, testsRequired: false })
}));
vi.mock("../src/plan/adr-loader.js", () => ({ loadActiveAdrs: vi.fn(async () => []) }));
vi.mock("../src/hu/acceptance-runner.js", () => ({
  runAcceptanceTests: vi.fn(async () => ({ allPassed: true, summary: "ok", results: [] })),
  buildDiagnosticPrompt: vi.fn(() => "")
}));

const { runHuBatch } = await import("../src/orchestrator/drivers/run-hu-batch.js");

function buildCtx() {
  return {
    config: {
      projectDir: "/proj", max_iterations: 5, hu_max_iterations: 3,
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: true }, policies: {}, git: { auto_commit: true }
    },
    pipelineFlags: { reviewerEnabled: true, testerEnabled: true },
    session: { id: "s_1", last_reviewer_feedback: null },
    brainCtx: { enabled: false },
    stageResults: { huReviewer: { certified: 1, total: 1, planId: null, review: null } },
    eventBase: { sessionId: "s_1", iteration: 0, stage: null, startedAt: 1 },
    coderRoleInstance: {}, coderRole: { provider: "claude" },
    trackBudget: vi.fn(), budgetTracker: null, plannedTask: "do x"
  };
}

describe("HU lane state isolation (PAR-E2 PR2)", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
  const emitter = { emit: vi.fn() };

  beforeEach(() => vi.clearAllMocks());

  it("shared ctx comes out untouched even when policies disable everything", async () => {
    const ctx = buildCtx();
    const configBefore = JSON.stringify(ctx.config);
    const flagsBefore = JSON.stringify(ctx.pipelineFlags);

    const { result } = await runHuBatch({ ctx, task: "t", askQuestion: vi.fn(), emitter, logger });

    expect(result.approved).toBe(true);
    expect(JSON.stringify(ctx.config)).toBe(configBefore);
    expect(JSON.stringify(ctx.pipelineFlags)).toBe(flagsBefore);
  });

  it("worktree lane hands the coder a lane config and a cloned session", async () => {
    const ctx = buildCtx();
    await runHuBatch({ ctx, task: "t", askQuestion: vi.fn(), emitter, logger });

    const coderArgs = runCoderStageMock.mock.calls[0][0];
    expect(coderArgs.config.projectDir).toBe("/proj/.kj/worktrees/HU-1");
    expect(coderArgs.config.max_iterations).toBe(3);
    expect(coderArgs.config.sonarqube.enabled).toBe(false);
    expect(coderArgs.session).not.toBe(ctx.session);
    expect(coderArgs.session.id).toBe("s_1");

    // Worktree lane never checks out the main tree; commit runs in the lane
    expect(prepareHuBranchMock).not.toHaveBeenCalled();
    expect(finalizeHuCommitMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/proj/.kj/worktrees/HU-1", branchName: "kj-hu-HU-1" })
    );
  });
});
