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

vi.mock("../src/session-store.js", () => ({
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

    it("returns continue when tester fails (under retry limit)", async () => {
      testerRunMock.mockResolvedValueOnce({ ok: false, summary: "Tests failing" });
      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };

      const result = await runTesterStage({
        config: { session: { max_tester_retries: 2 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.auto_continued).toBe(true);
    });

    it("auto-continues with advisory when tester retries exhausted (Solomon autonomous)", async () => {
      testerRunMock.mockResolvedValueOnce({ ok: false, summary: "Tests failing" });

      const session = { id: "s1", task: "t", checkpoints: [], tester_retry_count: 0 };

      const result = await runTesterStage({
        config: { session: { max_tester_retries: 1 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.auto_continued).toBe(true);
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

    it("auto-continues with advisory when security fails non-critical (Solomon autonomous)", async () => {
      securityRunMock.mockResolvedValueOnce({ ok: false, summary: "XSS found" });
      const session = { id: "s1", task: "t", checkpoints: [], security_retry_count: 0 };

      const result = await runSecurityStage({
        config: { session: { max_security_retries: 2 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.auto_continued).toBe(true);
    });

    it("auto-continues with advisory when security retries exhausted (Solomon autonomous)", async () => {
      securityRunMock.mockResolvedValueOnce({ ok: false, summary: "XSS found" });

      const session = { id: "s1", task: "t", checkpoints: [], security_retry_count: 0 };

      const result = await runSecurityStage({
        config: { session: { max_security_retries: 1 } }, logger, emitter, eventBase,
        session, coderRole, trackBudget, iteration: 1, task: "t", diff: "diff"
      });

      expect(result.action).toBe("ok");
      expect(result.stageResult.auto_continued).toBe(true);
    });
  });
});
