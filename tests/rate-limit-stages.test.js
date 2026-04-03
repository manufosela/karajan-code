import { beforeEach, describe, expect, it, vi } from "vitest";

const coderExecuteMock = vi.fn();

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/roles/refactorer-role.js", () => ({
  RefactorerRole: class {
    async init() {}
    async execute() { return { ok: true, result: {} }; }
  }
}));

vi.mock("../src/roles/sonar-role.js", () => ({
  SonarRole: class {
    async init() {}
    async run() { return { ok: true, result: {} }; }
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
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content"),
  setProjectDir: vi.fn()
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({ ok: true })
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

describe("rate-limit handling in iteration stages", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 1, stage: null, startedAt: Date.now() };
  const trackBudget = vi.fn();

  let runCoderStage, runReviewerStage, pauseSession;

  beforeEach(async () => {
    vi.resetAllMocks();
    coderExecuteMock.mockResolvedValue({ ok: true, result: {} });

    ({ runCoderStage, runReviewerStage } =
      await import("../src/orchestrator/iteration-stages.js"));
    ({ pauseSession } = await import("../src/session-store.js"));
  });

  describe("runCoderStage with rate limit", () => {
    it("returns standby action when coder hits rate limit", async () => {
      coderExecuteMock.mockResolvedValueOnce({
        ok: false,
        result: {
          error: "You've exceeded your usage limit. Please wait until 3:00 PM to continue.",
          output: "",
          exitCode: 1
        },
        summary: "usage limit"
      });

      const session = { id: "s1", task: "t", checkpoints: [], last_reviewer_feedback: null, last_sonar_summary: null };
      const coderRoleInstance = { execute: coderExecuteMock };

      const result = await runCoderStage({
        coderRoleInstance,
        coderRole: { provider: "claude", model: "m" },
        config: {}, logger, emitter, eventBase, session,
        plannedTask: "task", trackBudget, iteration: 1
      });

      expect(result).toBeDefined();
      expect(result.action).toBe("standby");
      expect(result.standbyInfo.agent).toBe("claude");
      expect(result.standbyInfo.message).toBeTruthy();
    });

    it("still throws for non-rate-limit errors", async () => {
      coderExecuteMock.mockResolvedValueOnce({
        ok: false,
        result: { error: "Syntax error in file.js", output: "", exitCode: 1 },
        summary: "syntax error"
      });

      const session = { id: "s1", task: "t", checkpoints: [], last_reviewer_feedback: null, last_sonar_summary: null };
      const coderRoleInstance = { execute: coderExecuteMock };

      await expect(
        runCoderStage({
          coderRoleInstance,
          coderRole: { provider: "codex", model: null },
          config: {}, logger, emitter, eventBase, session,
          plannedTask: "t", trackBudget, iteration: 1
        })
      ).rejects.toThrow("Coder failed");
    });

    it("returns standby info with cooldown data when rate limited", async () => {
      coderExecuteMock.mockResolvedValueOnce({
        ok: false,
        result: {
          error: "Rate limit exceeded. Please try again later.",
          output: "",
          exitCode: 1
        }
      });

      const session = { id: "s1", task: "t", checkpoints: [], last_reviewer_feedback: null, last_sonar_summary: null };
      const coderRoleInstance = { execute: coderExecuteMock };

      const result = await runCoderStage({
        coderRoleInstance,
        coderRole: { provider: "claude", model: "m" },
        config: {}, logger, emitter, eventBase, session,
        plannedTask: "task", trackBudget, iteration: 1
      });

      expect(result.action).toBe("standby");
      expect(result.standbyInfo).toHaveProperty("agent");
      expect(result.standbyInfo).toHaveProperty("message");
    });
  });

  describe("runReviewerStage with rate limit", () => {
    it("returns standby when reviewer hits rate limit", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: null,
        attempts: [{
          reviewer: "codex",
          result: { error: "You exceeded your current quota, please check your plan." },
          execResult: { ok: false, result: { error: "You exceeded your current quota, please check your plan." } }
        }]
      });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [] };
      const repeatDetector = { addIteration: vi.fn() };

      const result = await runReviewerStage({
        reviewerRole: { provider: "codex", model: null },
        config: {}, logger, emitter, eventBase, session, trackBudget,
        iteration: 1, reviewRules: "rules", task: "t",
        repeatDetector, budgetSummary: vi.fn(() => ({ total_cost_usd: 0 }))
      });

      expect(result).toBeDefined();
      expect(result.action).toBe("standby");
      expect(result.standbyInfo.agent).toBe("codex");
      expect(result.standbyInfo.message).toContain("exceeded");
    });

    it("still throws for non-rate-limit reviewer failures", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: null,
        attempts: [{
          reviewer: "claude",
          result: { error: "Connection refused" }
        }]
      });

      const session = { id: "s1", session_start_sha: "abc", checkpoints: [] };
      const repeatDetector = { addIteration: vi.fn() };

      await expect(
        runReviewerStage({
          reviewerRole: { provider: "claude", model: null },
          config: {}, logger, emitter, eventBase, session, trackBudget,
          iteration: 1, reviewRules: "rules", task: "t",
          repeatDetector, budgetSummary: vi.fn(() => ({ total_cost_usd: 0 }))
        })
      ).rejects.toThrow("Reviewer failed");
    });
  });
});
