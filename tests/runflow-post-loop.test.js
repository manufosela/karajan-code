import { beforeEach, describe, expect, it, vi } from "vitest";

const testerRunMock = vi.fn();
const securityRunMock = vi.fn();

vi.mock("../src/roles/tester-role.js", () => ({
  TesterRole: class {
    async init() {}
    async run(input) { return testerRunMock(input); }
  }
}));

vi.mock("../src/roles/security-role.js", () => ({
  SecurityRole: class {
    async init() {}
    async run(input) { return securityRunMock(input); }
  }
}));

vi.mock("../src/session/store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn()
}));

describe("post-loop-stages", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 1, stage: null, startedAt: Date.now() };
  const coderRole = { provider: "codex", model: "m" };
  const trackBudget = vi.fn();

  let runTesterStage, runSecurityStage;

  beforeEach(async () => {
    vi.resetAllMocks();
    testerRunMock.mockResolvedValue({ ok: true, summary: "All tests passed" });
    securityRunMock.mockResolvedValue({ ok: true, summary: "No vulnerabilities" });

    ({ runTesterStage, runSecurityStage } = await import("../src/orchestrator/post-loop-stages.js"));
  });

  describe("runTesterStage", () => {
    it("returns ok with stage result when tester passes", async () => {
      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };
      const result = await runTesterStage({
        config: { session: {} }, logger, emitter, eventBase, session,
        coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.ok).toBe(true);
      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "tester" }));
    });

    it("returns continue (blocking) when tester fails", async () => {
      testerRunMock.mockResolvedValueOnce({ ok: false, summary: "Tests failing", result: { verdict: "fail" } });
      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };

      const result = await runTesterStage({
        config: { session: { max_tester_retries: 2 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("continue");
      expect(result.stageResult.summary).toBe("Tests failing");
    });

    it("returns continue (blocking) when tester fails regardless of retry count", async () => {
      testerRunMock.mockResolvedValueOnce({ ok: false, summary: "Tests failing", result: { verdict: "fail" } });

      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };

      const result = await runTesterStage({
        config: { session: { max_tester_retries: 1 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("continue");
      expect(result.stageResult.summary).toBe("Tests failing");
    });

    // regression-for: regression
    it("propagates verdict + failing_scenarios + translated_scenarios on the OK path (regression: FASE-2 run blocker)", async () => {
      // Pre-fix, the OK return shape was just { ok, summary } — losing the
      // verdict, failing_scenarios, translated_scenarios that the role
      // produced. Callers in run-hu-batch.js read `stageResult.verdict`
      // to decide approve-vs-feedback when Gherkin translation is in
      // play; with the verdict undefined every Gherkin-bearing HU fell
      // into the "fail" branch and burned all max_iterations on a tester
      // that had actually passed. This pins the propagation so the
      // mismatch can't come back.
      testerRunMock.mockResolvedValueOnce({
        ok: true,
        summary: "Verdict: pass; Coverage: 78.7%; 1 scenario(s) translated",
        result: {
          verdict: "pass",
          tests_pass: true,
          coverage: { overall: 78.7 },
          translated_scenarios: ["scenario A"],
          failing_scenarios: [],
          missing_scenarios: ["scenario B (deferred)"],
        },
      });
      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };

      const result = await runTesterStage({
        config: { session: {} }, logger, emitter, eventBase, session,
        coderRole, trackBudget, iteration: 1, task: "t", diff: "diff",
        pendingGherkinTests: [{ content: "Given … When … Then …" }],
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.verdict).toBe("pass");
      expect(result.stageResult.failing_scenarios).toEqual([]);
      expect(result.stageResult.translated_scenarios).toEqual(["scenario A"]);
      expect(result.stageResult.coverage).toEqual({ overall: 78.7 });
      // summary is still set for compatibility with non-Gherkin callers.
      expect(result.stageResult.summary).toContain("Coverage");
    });
  });

  describe("runSecurityStage", () => {
    it("returns ok with stage result when security passes", async () => {
      const session = { id: "s1", task: "t", checkpoints: [], security_retry_count: 0 };
      const result = await runSecurityStage({
        config: { session: {} }, logger, emitter, eventBase, session,
        coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.ok).toBe(true);
      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "security" }));
    });

    it("returns continue (blocking) when security fails non-critical", async () => {
      securityRunMock.mockResolvedValueOnce({ ok: false, summary: "XSS found", result: { verdict: "fail" } });
      const session = { id: "s1", task: "t", checkpoints: [], security_retry_count: 0 };

      const result = await runSecurityStage({
        config: { session: { max_security_retries: 2 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("continue");
      expect(result.stageResult.summary).toBe("XSS found");
    });

    it("returns continue (blocking) when security fails regardless of retry count", async () => {
      securityRunMock.mockResolvedValueOnce({ ok: false, summary: "XSS found", result: { verdict: "fail" } });

      const session = { id: "s1", task: "t", checkpoints: [], security_retry_count: 0 };

      const result = await runSecurityStage({
        config: { session: { max_security_retries: 1 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("continue");
      expect(result.stageResult.summary).toBe("XSS found");
    });
  });
});
