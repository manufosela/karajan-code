import { beforeEach, describe, expect, it, vi } from "vitest";

const coderExecuteMock = vi.fn();
const refactorerExecuteMock = vi.fn();
const sonarRunMock = vi.fn();

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/roles/refactorer-role.js", () => ({
  RefactorerRole: class {
    async init() {}
    async execute(task) { return refactorerExecuteMock(task); }
  }
}));

vi.mock("../src/roles/sonar-role.js", () => ({
  SonarRole: class {
    async init() {}
    async run() { return sonarRunMock(); }
  }
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {}),
  pauseSession: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));

vi.mock("../src/review/diff-generator.js", () => ({
  generateDiff: vi.fn().mockResolvedValue("diff content")
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({
    ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK"
  })
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/orchestrator/reviewer-fallback.js", () => ({
  runReviewerWithFallback: vi.fn()
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn()
}));

describe("iteration-stages", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 1, stage: null, startedAt: Date.now() };
  const trackBudget = vi.fn();
  const budgetSummary = vi.fn(() => ({ total_cost_usd: 0.1 }));

  let runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runReviewerStage;

  beforeEach(async () => {
    vi.resetAllMocks();
    coderExecuteMock.mockResolvedValue({ ok: true, result: {} });
    refactorerExecuteMock.mockResolvedValue({ ok: true, result: {} });
    sonarRunMock.mockResolvedValue({
      ok: true,
      summary: "Sonar passed",
      result: { gateStatus: "OK", blocking: false, openIssuesTotal: 0, projectKey: "k" }
    });

    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({
      ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK"
    });

    const { generateDiff } = await import("../src/review/diff-generator.js");
    generateDiff.mockResolvedValue("diff content");

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => r);

    ({ runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runReviewerStage } =
      await import("../src/orchestrator/iteration-stages.js"));
  });

  describe("runCoderStage", () => {
    it("executes coder and tracks budget", async () => {
      const coderRoleInstance = { execute: coderExecuteMock };
      const session = { id: "s1", task: "t", last_reviewer_feedback: null, last_sonar_summary: null, checkpoints: [] };

      await runCoderStage({
        coderRoleInstance,
        coderRole: { provider: "codex", model: "m" },
        config: {}, logger, emitter, eventBase, session,
        plannedTask: "task", trackBudget, iteration: 1
      });

      expect(coderExecuteMock).toHaveBeenCalledTimes(1);
      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
    });

    it("throws when coder fails", async () => {
      coderExecuteMock.mockResolvedValueOnce({ ok: false, result: { error: "timeout" }, summary: "timeout" });
      const coderRoleInstance = { execute: coderExecuteMock };
      const session = { id: "s1", task: "t", checkpoints: [] };

      await expect(
        runCoderStage({
          coderRoleInstance, coderRole: { provider: "codex", model: null },
          config: {}, logger, emitter, eventBase, session,
          plannedTask: "t", trackBudget, iteration: 1
        })
      ).rejects.toThrow("Coder failed");
    });
  });

  describe("runRefactorerStage", () => {
    it("executes refactorer and tracks budget", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runRefactorerStage({
        refactorerRole: { provider: "claude", model: "m" },
        config: {}, logger, emitter, eventBase, session,
        plannedTask: "task", trackBudget, iteration: 1
      });

      expect(refactorerExecuteMock).toHaveBeenCalledTimes(1);
      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "refactorer" }));
    });

    it("throws when refactorer fails", async () => {
      refactorerExecuteMock.mockResolvedValueOnce({ ok: false, result: { error: "crash" } });
      const session = { id: "s1", task: "t", checkpoints: [] };

      await expect(
        runRefactorerStage({
          refactorerRole: { provider: "claude", model: null },
          config: {}, logger, emitter, eventBase, session,
          plannedTask: "t", trackBudget, iteration: 1
        })
      ).rejects.toThrow("Refactorer failed");
    });
  });

  describe("runTddCheckStage", () => {
    it("returns ok when TDD passes", async () => {
      const session = { id: "s1", session_start_sha: "abc", checkpoints: [], repeated_issue_count: 0 };
      const config = { development: {}, session: { fail_fast_repeats: 2 } };

      const result = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: 1 });
      expect(result.action).toBe("ok");
    });

    it("returns continue when TDD fails (under threshold)", async () => {
      const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
      evaluateTddPolicy.mockReturnValueOnce({ ok: false, reason: "no tests", message: "Missing tests", sourceFiles: ["a.js"], testFiles: [] });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [], repeated_issue_count: 0 };
      const config = { development: {}, session: { fail_fast_repeats: 3 } };

      const result = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: 1 });
      expect(result.action).toBe("continue");
    });

    it("returns pause when TDD fails repeatedly without askQuestion", async () => {
      const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
      evaluateTddPolicy.mockReturnValue({ ok: false, reason: "no tests", message: "Missing", sourceFiles: ["a.js"], testFiles: [] });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [], repeated_issue_count: 1 };
      const config = { development: {}, session: { fail_fast_repeats: 2 } };

      const result = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: 1, askQuestion: null });
      expect(result.action).toBe("pause");
      expect(result.result.paused).toBe(true);
    });
  });

  describe("runSonarStage", () => {
    it("returns ok with stage result when sonar passes", async () => {
      const session = { id: "s1", session_start_sha: "abc", checkpoints: [], sonar_retry_count: 0 };
      const sonarState = { issuesInitial: null, issuesFinal: null };
      const repeatDetector = { addIteration: vi.fn(), isStalled: vi.fn(() => ({ stalled: false })) };

      const result = await runSonarStage({
        config: { session: {} }, logger, emitter, eventBase, session, trackBudget,
        iteration: 1, repeatDetector, budgetSummary, sonarState, task: "t"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.gateStatus).toBe("OK");
    });

    it("returns continue when sonar blocks (under retry limit)", async () => {
      sonarRunMock.mockResolvedValueOnce({
        ok: true,
        summary: "blocking",
        result: { gateStatus: "ERROR", blocking: true, openIssuesTotal: 5, projectKey: "k", issues: [] }
      });
      const session = { id: "s1", checkpoints: [], sonar_retry_count: 0 };
      const sonarState = { issuesInitial: null, issuesFinal: null };
      const repeatDetector = { addIteration: vi.fn(), isStalled: vi.fn(() => ({ stalled: false })) };

      const result = await runSonarStage({
        config: { session: { max_sonar_retries: 3, fail_fast_repeats: 2 } },
        logger, emitter, eventBase, session, trackBudget,
        iteration: 1, repeatDetector, budgetSummary, sonarState, task: "t"
      });

      expect(result.action).toBe("continue");
    });

    it("throws when sonar scan has hard error", async () => {
      sonarRunMock.mockResolvedValueOnce({
        ok: false,
        summary: "error",
        result: { gateStatus: null, error: "Connection refused" }
      });
      const session = { id: "s1", checkpoints: [], sonar_retry_count: 0 };
      const sonarState = { issuesInitial: null, issuesFinal: null };
      const repeatDetector = { addIteration: vi.fn() };

      await expect(
        runSonarStage({
          config: { session: {} }, logger, emitter, eventBase, session, trackBudget,
          iteration: 1, repeatDetector, budgetSummary, sonarState, task: "t"
        })
      ).rejects.toThrow("Sonar scan failed");
    });
  });

  describe("runReviewerStage", () => {
    it("returns approved review", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: {
          ok: true,
          result: { approved: true, blocking_issues: [], non_blocking_suggestions: [], raw_summary: "OK", confidence: 0.9 }
        },
        attempts: []
      });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [] };
      const repeatDetector = { addIteration: vi.fn(), isStalled: vi.fn(() => ({ stalled: false })) };

      const result = await runReviewerStage({
        reviewerRole: { provider: "claude", model: "m" },
        config: {}, logger, emitter, eventBase, session, trackBudget,
        iteration: 1, reviewRules: "rules", task: "t",
        repeatDetector, budgetSummary
      });

      expect(result.review.approved).toBe(true);
      expect(result.stalled).toBeUndefined();
    });

    it("throws when reviewer fails completely", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: null,
        attempts: [{ reviewer: "claude", result: { error: "timeout" } }]
      });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [] };
      const repeatDetector = { addIteration: vi.fn() };

      await expect(
        runReviewerStage({
          reviewerRole: { provider: "claude", model: null },
          config: {}, logger, emitter, eventBase, session, trackBudget,
          iteration: 1, reviewRules: "rules", task: "t",
          repeatDetector, budgetSummary
        })
      ).rejects.toThrow("Reviewer failed");
    });

    it("returns stalled when reviewer issues repeat and Solomon pauses", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      const { invokeSolomon } = await import("../src/orchestrator/solomon-escalation.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: {
          ok: true,
          result: { approved: false, blocking_issues: [{ id: "B1", description: "bug" }], non_blocking_suggestions: [], raw_summary: "Rejected", confidence: 0.8 }
        },
        attempts: []
      });
      invokeSolomon.mockResolvedValue({ action: "pause", question: "Stalled" });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [] };
      const repeatDetector = {
        addIteration: vi.fn(),
        isStalled: vi.fn(() => ({ stalled: true, reason: "reviewer_repeat" })),
        getRepeatCounts: vi.fn(() => ({ reviewer: 3 })),
        reviewer: { lastHash: null, repeatCount: 3 }
      };

      const result = await runReviewerStage({
        reviewerRole: { provider: "claude", model: null },
        config: {}, logger, emitter, eventBase, session, trackBudget,
        iteration: 1, reviewRules: "rules", task: "t",
        repeatDetector, budgetSummary
      });

      expect(result.stalled).toBe(true);
      expect(result.stalledResult.context).toBe("reviewer_stalled");
    });
  });
});
