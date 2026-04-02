import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => ({
  createSession: vi.fn(async (init) => ({ id: "sess-1", created_at: "2026-03-07T00:00:00Z", checkpoints: [], ...init })),
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
  setRunner: vi.fn()
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
  finalizeGitAutomation: vi.fn(async () => ({ commits: [{ hash: "abc", message: "feat: done" }] }))
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

const mockFetchCard = vi.fn();
const mockUpdateCard = vi.fn();

vi.mock("../src/planning-game/client.js", () => ({
  fetchCard: (...args) => mockFetchCard(...args),
  updateCard: (...args) => mockUpdateCard(...args)
}));

const { runFlow } = await import("../src/orchestrator.js");
const { runCoderStage, runTddCheckStage, runReviewerStage } = await import("../src/orchestrator/iteration-stages.js");

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
    max_iterations: 1,
    max_budget_usd: null,
    base_branch: "main",
    coder_options: { model: null },
    reviewer_options: { model: null, fallback_reviewer: "codex" },
    development: { methodology: "standard", require_test_changes: false },
    sonarqube: { enabled: false },
    serena: { enabled: false },
    planning_game: { enabled: true, codeveloper: "dev_001" },
    git: { auto_commit: false, auto_push: false, auto_pr: false },
    output: { report_dir: "./.reviews", log_level: "info" },
    budget: { warn_threshold_pct: 80 },
    model_selection: { enabled: false },
    session: {
      max_iteration_minutes: 30,
      max_total_minutes: 120,
      checkpoint_interval_minutes: 999,
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

describe("Planning Game integration in runFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCoderStage.mockResolvedValue({ action: "ok" });
    runTddCheckStage.mockResolvedValue({ action: "ok" });
    runReviewerStage.mockResolvedValue({ action: "ok", review: { approved: true, blocking_issues: [], summary: "ok", confidence: 1 } });
    mockFetchCard.mockResolvedValue({
      cardId: "KJC-TSK-0099",
      firebaseId: "-Oabc123",
      title: "Test task",
      status: "To Do"
    });
    mockUpdateCard.mockResolvedValue({ message: "ok" });
  });

  it("marks PG card as In Progress at session start", async () => {
    await runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    });

    expect(mockFetchCard).toHaveBeenCalledWith({
      projectId: "Karajan Code",
      cardId: "KJC-TSK-0099"
    });

    const inProgressCall = mockUpdateCard.mock.calls.find(
      (call) => call[0]?.updates?.status === "In Progress"
    );
    expect(inProgressCall).toBeDefined();
    expect(inProgressCall[0].updates.developer).toBe("dev_016");
    expect(inProgressCall[0].updates.codeveloper).toBe("dev_001");
    expect(inProgressCall[0].updates.startDate).toBeDefined();
  });

  it("marks PG card as To Validate on approved completion", async () => {
    await runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    });

    const toValidateCall = mockUpdateCard.mock.calls.find(
      (call) => call[0]?.updates?.status === "To Validate"
    );
    expect(toValidateCall).toBeDefined();
    expect(toValidateCall[0].updates.developer).toBe("dev_016");
    expect(toValidateCall[0].updates.endDate).toBeDefined();
  });

  it("skips PG card already In Progress", async () => {
    mockFetchCard.mockResolvedValue({
      cardId: "KJC-TSK-0099",
      firebaseId: "-Oabc123",
      title: "Test task",
      status: "In Progress"
    });

    await runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    });

    // Should NOT call updateCard with "In Progress" (already there)
    const inProgressCall = mockUpdateCard.mock.calls.find(
      (call) => call[0]?.updates?.status === "In Progress"
    );
    expect(inProgressCall).toBeUndefined();
  });

  it("does not touch PG when planning_game is disabled", async () => {
    const config = makeConfig({ planning_game: { enabled: false } });

    await runFlow({
      task: "Fix bug",
      config,
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    });

    expect(mockFetchCard).not.toHaveBeenCalled();
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("does not touch PG when no pgTaskId provided", async () => {
    await runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger
    });

    expect(mockFetchCard).not.toHaveBeenCalled();
  });

  it("handles PG errors gracefully without failing the run", async () => {
    mockFetchCard.mockRejectedValue(new Error("PG unavailable"));

    const result = await runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    });

    expect(result.approved).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("PG unavailable")
    );
  });
});
