import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAuditInit = vi.fn(async () => {});
const mockAuditRun = vi.fn();

vi.mock("../src/roles/tester-role.js", () => ({ TesterRole: class {} }));
vi.mock("../src/roles/security-role.js", () => ({ SecurityRole: class {} }));
vi.mock("../src/roles/impeccable-role.js", () => ({ ImpeccableRole: class {} }));
vi.mock("../src/roles/audit-role.js", () => ({
  AuditRole: class {
    constructor() {}
    async init() { return mockAuditInit(); }
    async run(input) { return mockAuditRun(input); }
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

const { runFinalAuditStage } = await import("../src/orchestrator/post-loop-stages.js");

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
}

function makeBaseArgs(overrides = {}) {
  return {
    config: { roles: {} },
    logger: makeLogger(),
    emitter: { emit: vi.fn() },
    eventBase: { sessionId: "s1", iteration: 1, stage: null, startedAt: Date.now() },
    session: { id: "s1", checkpoints: [] },
    coderRole: { provider: "claude", model: "claude-sonnet" },
    trackBudget: vi.fn(),
    iteration: 1,
    task: "implement feature X",
    diff: "diff --git a/file.js ...",
    ...overrides
  };
}

describe("runFinalAuditStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with CERTIFIED when audit finds no critical/high issues (good health)", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "good", totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0 },
        dimensions: {},
        topRecommendations: []
      },
      summary: "Overall health: good. 0 findings (no issues)"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    expect(result.action).toBe("ok");
    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.summary).toContain("CERTIFIED");
  });

  it("returns ok with CERTIFIED and advisory warning when only medium/low findings", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "fair", totalFindings: 2, critical: 0, high: 0, medium: 1, low: 1 },
        dimensions: {
          codeQuality: { score: "B", findings: [
            { severity: "medium", file: "src/a.js", line: 10, rule: "DRY", description: "Duplicated logic", recommendation: "Extract function" },
            { severity: "low", file: "src/b.js", line: 5, rule: "KISS", description: "Complex expression", recommendation: "Simplify" }
          ] }
        },
        topRecommendations: []
      },
      summary: "Overall health: fair. 2 findings (1 medium, 1 low)"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    expect(result.action).toBe("ok");
    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.summary).toContain("CERTIFIED");
  });

  it("returns retry with feedback when audit finds critical issues (poor health)", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "poor", totalFindings: 2, critical: 1, high: 1, medium: 0, low: 0 },
        dimensions: {
          security: { score: "D", findings: [
            { severity: "critical", file: "src/auth.js", line: 42, rule: "SEC-001", description: "Hardcoded API key", recommendation: "Use environment variable" }
          ] },
          codeQuality: { score: "C", findings: [
            { severity: "high", file: "src/utils.js", line: 100, rule: "SOLID-001", description: "God function with 200 lines", recommendation: "Split into smaller functions" }
          ] }
        },
        topRecommendations: []
      },
      summary: "Overall health: poor. 2 findings (1 critical, 1 high)"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    expect(result.action).toBe("retry");
    expect(result.feedback).toContain("Hardcoded API key");
    expect(result.feedback).toContain("God function");
    expect(result.feedback).toContain("2 critical/high issue(s)");
    expect(result.stageResult.ok).toBe(false);
  });

  it("returns retry when health is critical with high findings", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "critical", totalFindings: 1, critical: 0, high: 1, medium: 0, low: 0 },
        dimensions: {
          architecture: { score: "F", findings: [
            { severity: "high", file: "src/core.js", line: 1, rule: "ARCH-001", description: "Circular dependency", recommendation: "Refactor imports" }
          ] }
        },
        topRecommendations: []
      },
      summary: "Overall health: critical. 1 findings (1 high)"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    expect(result.action).toBe("retry");
    expect(result.feedback).toContain("Circular dependency");
  });

  it("returns ok (advisory) when audit agent fails to run", async () => {
    mockAuditRun.mockResolvedValue({
      ok: false,
      result: { error: "Agent spawn failed" },
      summary: "Audit failed: Agent spawn failed"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    expect(result.action).toBe("ok");
    expect(result.stageResult.ok).toBe(false);
    expect(result.stageResult.auto_continued).toBe(true);
  });

  it("does not retry when health is poor but no critical/high findings", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "poor", totalFindings: 3, critical: 0, high: 0, medium: 2, low: 1 },
        dimensions: {
          codeQuality: { score: "D", findings: [
            { severity: "medium", file: "a.js", line: 1, rule: "", description: "Issue 1", recommendation: "" },
            { severity: "medium", file: "b.js", line: 1, rule: "", description: "Issue 2", recommendation: "" },
            { severity: "low", file: "c.js", line: 1, rule: "", description: "Issue 3", recommendation: "" }
          ] }
        },
        topRecommendations: []
      },
      summary: "Overall health: poor. 3 findings (2 medium, 1 low)"
    });

    const args = makeBaseArgs();
    const result = await runFinalAuditStage(args);

    // Poor health but no critical/high — pass with warnings
    expect(result.action).toBe("ok");
    expect(result.stageResult.ok).toBe(true);
  });

  it("emits audit:start and audit:end events", async () => {
    const { emitProgress } = await import("../src/utils/events.js");
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "good", totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0 },
        dimensions: {},
        topRecommendations: []
      },
      summary: "Overall health: good. 0 findings (no issues)"
    });

    const args = makeBaseArgs();
    await runFinalAuditStage(args);

    const startCalls = emitProgress.mock.calls.filter(([, evt]) => evt?.type === "audit:start");
    const endCalls = emitProgress.mock.calls.filter(([, evt]) => evt?.type === "audit:end");
    expect(startCalls.length).toBeGreaterThanOrEqual(1);
    expect(endCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("tracks budget for the audit stage", async () => {
    mockAuditRun.mockResolvedValue({
      ok: true,
      result: {
        summary: { overallHealth: "good", totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0 },
        dimensions: {},
        topRecommendations: []
      },
      summary: "All good"
    });

    const args = makeBaseArgs();
    await runFinalAuditStage(args);

    expect(args.trackBudget).toHaveBeenCalledWith(
      expect.objectContaining({ role: "audit" })
    );
  });
});
