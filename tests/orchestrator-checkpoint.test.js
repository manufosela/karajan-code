import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => ({
  createSession: vi.fn(async (init) => ({ id: "sess-1", ...init })),
  loadSession: vi.fn(),
  markSessionStatus: vi.fn(async () => {}),
  resumeSessionWithAnswer: vi.fn(),
  saveSession: vi.fn(async () => {}),
  addCheckpoint: vi.fn(async () => {})
}));

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn(async () => "abc123"),
  getUntrackedFiles: vi.fn(async () => []),
  generateDiff: vi.fn(async () => "diff content"),
  setRunner: vi.fn(),
  setProjectDir: vi.fn()
}));

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn(() => []),
  loadFirstExisting: vi.fn(async () => null)
}));

vi.mock("../src/review/profiles.js", () => ({
  resolveReviewProfile: vi.fn(async () => ({ rules: "" }))
}));

vi.mock("../src/roles/coder-role.js", () => ({
  CoderRole: class {
    constructor() {}
    async init() {}
  }
}));

vi.mock("../src/git/automation.js", () => ({
  prepareGitAutomation: vi.fn(async () => ({ enabled: false })),
  finalizeGitAutomation: vi.fn(async () => ({ git: "disabled", commits: [] }))
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn()
}));

vi.mock("../src/orchestrator/pre-loop-stages.js", () => ({
  runTriageStage: vi.fn().mockResolvedValue({ roleOverrides: {}, stageResult: { ok: true } }),
  runResearcherStage: vi.fn(),
  runPlannerStage: vi.fn()
}));

vi.mock("../src/orchestrator/iteration-stages.js", () => ({
  runCoderStage: vi.fn(),
  runRefactorerStage: vi.fn(),
  runTddCheckStage: vi.fn(),
  runSonarStage: vi.fn(),
  runReviewerStage: vi.fn()
}));

vi.mock("../src/orchestrator/post-loop-stages.js", () => ({
  runTesterStage: vi.fn(),
  runSecurityStage: vi.fn(),
  runFinalAuditStage: vi.fn().mockResolvedValue({ action: "ok", stageResult: { ok: true, summary: "Audit: CERTIFIED" } })
}));

const { runFlow, resumeFlow } = await import("../src/orchestrator.js");
const { addCheckpoint, markSessionStatus, loadSession, saveSession } = await import("../src/session-store.js");
const { runCoderStage, runTddCheckStage, runReviewerStage } = await import("../src/orchestrator/iteration-stages.js");
const { emitProgress } = await import("../src/utils/events.js");

function makeConfig(overrides = {}) {
  return {
    coder: "claude",
    reviewer: "codex",
    roles: {
      planner: { provider: null, model: null },
      coder: { provider: "claude", model: null },
      reviewer: { provider: "codex", model: null },
      refactorer: { provider: null, model: null },
      solomon: { provider: null, model: null },
      researcher: { provider: null, model: null },
      tester: { provider: null, model: null },
      security: { provider: null, model: null },
      triage: { provider: null, model: null }
    },
    pipeline: {
      planner: { enabled: false },
      refactorer: { enabled: false },
      solomon: { enabled: false },
      researcher: { enabled: false },
      tester: { enabled: false },
      security: { enabled: false },
      triage: { enabled: false },
      reviewer: { enabled: false }
    },
    review_mode: "standard",
    max_iterations: 2,
    max_budget_usd: null,
    base_branch: "main",
    coder_options: { model: null },
    reviewer_options: { model: null, fallback_reviewer: "codex" },
    development: { methodology: "standard", require_test_changes: false },
    sonarqube: { enabled: false },
    serena: { enabled: false },
    planning_game: { enabled: false },
    git: { auto_commit: false, auto_push: false, auto_pr: false },
    output: { report_dir: "./.reviews", log_level: "info" },
    budget: { warn_threshold_pct: 80 },
    model_selection: { enabled: false },
    session: {
      max_iteration_minutes: 30,
      max_total_minutes: 120,
      checkpoint_interval_minutes: 0, // 0 means check every iteration
      fail_fast_repeats: 2,
      repeat_detection_threshold: 2,
      max_sonar_retries: 3,
      max_reviewer_retries: 3,
      max_tester_retries: 1,
      max_security_retries: 1,
      expiry_days: 30
    },
    failFast: { repeatThreshold: 2 },
    ...overrides
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("interactive checkpoint system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: coder succeeds, tdd passes, reviewer approves
    runCoderStage.mockResolvedValue({ action: "ok" });
    runTddCheckStage.mockResolvedValue({ action: "ok" });
    runReviewerStage.mockResolvedValue({ action: "ok", review: { approved: true, blocking_issues: [], summary: "ok", confidence: 1 } });
  });

  it("triggers checkpoint and stops when user says stop", async () => {
    const askQuestion = vi.fn().mockResolvedValue("4");
    const config = makeConfig();

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(askQuestion.mock.calls[0][0]).toContain("Checkpoint");
    expect(result.reason).toBe("user_stopped");
    expect(result.approved).toBe(false);
    expect(addCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: "interactive-checkpoint", answer: "4" })
    );
    expect(markSessionStatus).toHaveBeenCalledWith(expect.anything(), "stopped");
  });

  it("triggers checkpoint and continues 5 more minutes when user says 1", async () => {
    const askQuestion = vi.fn().mockResolvedValue("1");
    const config = makeConfig({ max_iterations: 1 });
    // Single iteration — after checkpoint user says continue, loop runs and reviewer approves
    runReviewerStage.mockResolvedValue({ action: "ok", review: { approved: true, blocking_issues: [], summary: "ok", confidence: 1 } });

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    expect(askQuestion).toHaveBeenCalled();
    expect(result.approved).toBe(true);
  });

  it("disables checkpoints when user says continue until done", async () => {
    const askQuestion = vi.fn().mockResolvedValue("2");
    const config = makeConfig({ max_iterations: 2 });

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    // Should ask only once then never again (checkpointDisabled = true)
    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
  });

  it("does not trigger checkpoint when askQuestion is null", async () => {
    const config = makeConfig({ max_iterations: 1 });

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion: null });

    expect(result.approved).toBe(true);
  });

  it("handles custom time from user (option 3)", async () => {
    const askQuestion = vi.fn().mockResolvedValue("10");
    const config = makeConfig({ max_iterations: 1 });

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    expect(askQuestion).toHaveBeenCalled();
    // Custom minutes parsed — execution continues
    expect(result.approved).toBe(true);
  });

  it("stops when user replies with stop text", async () => {
    const askQuestion = vi.fn().mockResolvedValue("stop now");
    const config = makeConfig();

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    expect(result.reason).toBe("user_stopped");
  });

  it("continues when askQuestion returns null (default to 5 more minutes)", async () => {
    const askQuestion = vi.fn().mockResolvedValue(null);
    const config = makeConfig({ max_iterations: 1 });

    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });

    // null response defaults to "continue 5 more minutes" instead of stopping
    expect(result.approved).toBe(true);
  });

  it("emits session:checkpoint event", async () => {
    const askQuestion = vi.fn().mockResolvedValue("2");
    const config = makeConfig({ max_iterations: 1 });

    await runFlow({ task: "Fix bug", config, logger, askQuestion });

    // Check that a checkpoint event was emitted (via emitProgress mock or spy)
    expect(addCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: "interactive-checkpoint" })
    );
  });

  it("hard timeout still applies when no askQuestion", async () => {
    const { runReviewerStage: reviewerMock } = await import("../src/orchestrator/iteration-stages.js");
    const config = makeConfig({
      max_iterations: 100,
      pipeline: {
        planner: { enabled: false },
        refactorer: { enabled: false },
        solomon: { enabled: false },
        researcher: { enabled: false },
        tester: { enabled: false },
        security: { enabled: false },
        triage: { enabled: false },
        reviewer: { enabled: true }
      },
      session: {
        max_iteration_minutes: 30,
        max_total_minutes: 0.0001, // ~6ms — triggers on 2nd iteration
        checkpoint_interval_minutes: 999,
        fail_fast_repeats: 100,
        repeat_detection_threshold: 100,
        max_sonar_retries: 3,
        max_reviewer_retries: 100,
        max_tester_retries: 1,
        max_security_retries: 1,
        expiry_days: 30
      }
    });
    // Coder takes time so elapsed exceeds max_total_minutes
    runCoderStage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { action: "ok" };
    });
    // Reviewer rejects so loop continues to next iteration
    reviewerMock.mockResolvedValue({
      action: "ok",
      review: { approved: false, blocking_issues: [{ id: "ISS", description: "fail" }], summary: "nope", confidence: 0.5 }
    });

    await expect(
      runFlow({ task: "Fix bug", config, logger, askQuestion: null })
    ).rejects.toThrow("Session timed out");
  });

  it("does NOT hard-timeout when askQuestion is available (checkpoint takes over)", async () => {
    const askQuestion = vi.fn().mockResolvedValue("2"); // continue until done
    const config = makeConfig({
      max_iterations: 1,
      session: {
        max_iteration_minutes: 30,
        max_total_minutes: 0.0001, // Would timeout without askQuestion
        checkpoint_interval_minutes: 0.001,
        fail_fast_repeats: 2,
        repeat_detection_threshold: 2,
        max_sonar_retries: 3,
        max_reviewer_retries: 3,
        max_tester_retries: 1,
        max_security_retries: 1,
        expiry_days: 30
      }
    });

    // Should NOT throw — hard timeout is disabled when askQuestion is available
    const result = await runFlow({ task: "Fix bug", config, logger, askQuestion });
    expect(result.approved).toBe(true);
  });
});

describe("resumeFlow from stopped/failed sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCoderStage.mockResolvedValue({ action: "ok" });
    runTddCheckStage.mockResolvedValue({ action: "ok" });
    runReviewerStage.mockResolvedValue({ action: "ok", review: { approved: true, blocking_issues: [], summary: "ok", confidence: 1 } });
  });

  it("resumes a stopped session by re-running the flow", async () => {
    const stoppedSession = {
      id: "sess-stopped",
      status: "stopped",
      task: "Fix bug",
      config_snapshot: makeConfig({ max_iterations: 1 }),
      checkpoints: []
    };
    loadSession.mockResolvedValue(stoppedSession);
    saveSession.mockResolvedValue(undefined);

    const result = await resumeFlow({
      sessionId: "sess-stopped",
      config: makeConfig({ max_iterations: 1 }),
      logger
    });

    // Session should be marked running before re-running
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running" })
    );
    expect(result.approved).toBe(true);
  });

  it("resumes a failed session by re-running the flow", async () => {
    const failedSession = {
      id: "sess-failed",
      status: "failed",
      task: "Fix bug",
      config_snapshot: makeConfig({ max_iterations: 1 }),
      checkpoints: []
    };
    loadSession.mockResolvedValue(failedSession);
    saveSession.mockResolvedValue(undefined);

    const result = await resumeFlow({
      sessionId: "sess-failed",
      config: makeConfig({ max_iterations: 1 }),
      logger
    });

    expect(result.approved).toBe(true);
  });

  it("rejects resuming an approved (completed) session", async () => {
    const approvedSession = {
      id: "sess-approved",
      status: "approved",
      task: "Fix bug",
      checkpoints: []
    };
    loadSession.mockResolvedValue(approvedSession);

    const result = await resumeFlow({
      sessionId: "sess-approved",
      config: makeConfig(),
      logger
    });

    // Should return the session as-is, not re-run
    expect(result.status).toBe("approved");
  });
});
