import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session/store.js", () => ({
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
  setRunner: vi.fn(),
  setProjectDir: vi.fn()
}));

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn(() => []),
  loadFirstExisting: vi.fn(async () => null),
  // PR-L: flow-runner now statically imports drivers/run-hu-batch.js,
  // which transitively pulls in coder-stage → CoderRole → AgentRole →
  // BaseRole. The mock has to expose the BaseRole class so the import
  // resolves at test load time.
  BaseRole: class { constructor() {} async init() {} }
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

// KJC-TSK-0987: the acceptance-coverage judge is a stage of its own; here it
// answers what each test needs, and skips by default (the card has no criteria).
vi.mock("../src/orchestrator/stages/acceptance-coverage-stage.js", () => ({
  runAcceptanceCoverageStage: vi.fn(async () => ({ action: "skip" }))
}));

const mockFetchCard = vi.fn();
const mockUpdateCard = vi.fn();

vi.mock("../src/planning-game/client.js", () => ({
  fetchCard: (...args) => mockFetchCard(...args),
  updateCard: (...args) => mockUpdateCard(...args)
}));

const { runFlow } = await import("../src/orchestrator.js");
const { runCoderStage, runTddCheckStage, runReviewerStage } = await import("../src/orchestrator/iteration-stages.js");
const { runAcceptanceCoverageStage } = await import("../src/orchestrator/stages/acceptance-coverage-stage.js");
const { invokeSolomon } = await import("../src/orchestrator/solomon-escalation.js");

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

  // KJC-TSK-0987 (#1894): with a card that has criteria, the judge reads them
  // against the diff before the run is approved.
  describe("acceptance coverage of the card's criteria", () => {
    const cardWithCriteria = () => mockFetchCard.mockResolvedValue({
      cardId: "KJC-TSK-0099", firebaseId: "-Oabc123", title: "Login", status: "In Progress",
      acceptanceCriteriaStructured: [{ given: "a visitor", when: "they log in", then: "only the corporate domain is accepted" }],
    });
    const flow = () => runFlow({ task: "Login", config: makeConfig(), logger, pgTaskId: "KJC-TSK-0099", pgProject: "Karajan Code" });

    it("the judge gets the card's criteria and the run's diff; all covered keeps the approval", async () => {
      cardWithCriteria();
      runAcceptanceCoverageStage.mockResolvedValueOnce({ action: "ok", stageResult: { ok: true, uncovered: [] } });
      const result = await flow();
      expect(result.approved).toBe(true);
      expect(runAcceptanceCoverageStage).toHaveBeenCalledWith(expect.objectContaining({
        criteria: ["Given a visitor, when they log in, then only the corporate domain is accepted"], diff: "diff content",
      }));
    });

    it("an uncovered criterion is not an approval: it goes back to the coder, and the run ends unapproved when iterations run out", async () => {
      cardWithCriteria();
      runAcceptanceCoverageStage.mockResolvedValue({ action: "retry", stageResult: { ok: false, uncovered: [{ index: 1, text: "c1" }] }, feedback: "Acceptance criteria NOT covered" });
      invokeSolomon.mockResolvedValue({ action: "fail", reason: "max_iterations" }); // the loop ran out: Solomon does not rescue it
      const result = await flow();
      expect(result.approved).toBe(false);
      expect(mockUpdateCard.mock.calls.find((call) => call[0]?.updates?.status === "To Validate")).toBeUndefined();
    });

    it("a judge with no verdict stops the approval, never grants it", async () => {
      cardWithCriteria();
      runAcceptanceCoverageStage.mockResolvedValueOnce({ action: "fail", stageResult: { ok: false, summary: "no verdict" } });
      const result = await flow();
      expect(result).toMatchObject({ approved: false, reason: "acceptance_coverage_unavailable" });
    });
  });

  // KJC-BUG-0247 (#1894): a card that cannot be read used to be a warn line and
  // a run without the card's criteria that still said approved. It stops now.
  it("a named card that cannot be read stops the run before it starts", async () => {
    mockFetchCard.mockRejectedValue(new Error("PG unavailable"));

    await expect(runFlow({
      task: "Fix bug",
      config: makeConfig(),
      logger,
      pgTaskId: "KJC-TSK-0099",
      pgProject: "Karajan Code"
    })).rejects.toThrow(/KJC-TSK-0099 could not be read \(PG unavailable\)/);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("acceptance criteria"));
  });
});
