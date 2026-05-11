import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const triageRunMock = vi.fn();

vi.mock("../../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() {
      return triageRunMock();
    }
  }
}));

vi.mock("../../src/session/store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {})
}));

vi.mock("../../src/utils/model-selector.js", () => ({
  selectModelsForRoles: vi.fn(() => ({ modelOverrides: {}, reasoning: "test" }))
}));

const { runTriageStage } = await import("../../src/orchestrator/pre-loop-stages.js");

describe("runTriageStage", () => {
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const trackBudget = vi.fn();

  let emitter;
  let config;
  let session;
  let eventBase;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    config = {
      roles: {
        triage: { provider: "claude", model: null },
        coder: { provider: "codex", model: null }
      },
      model_selection: { enabled: false }
    };
    session = { id: "s_test", task: "Fix bug in login", checkpoints: [] };
    eventBase = { sessionId: "s_test", iteration: 0, stage: null, startedAt: Date.now() };

    triageRunMock.mockResolvedValue({
      ok: true,
      result: {
        level: "medium",
        roles: ["reviewer", "tester"],
        reasoning: "Moderate complexity with logic changes"
      },
      usage: { tokens_in: 100, tokens_out: 80 }
    });
  });

  it("returns parsed triage decision with roleOverrides", async () => {
    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.roleOverrides.testerEnabled).toBe(true);
    expect(result.roleOverrides.reviewerEnabled).toBe(true);
    expect(result.roleOverrides.plannerEnabled).toBe(false);
    expect(result.roleOverrides.securityEnabled).toBe(false);
    expect(result.roleOverrides.refactorerEnabled).toBe(false);
    expect(result.roleOverrides.researcherEnabled).toBe(false);
  });

  it("returns stageResult with level, roles, and reasoning", async () => {
    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.level).toBe("medium");
    expect(result.stageResult.roles).toEqual(["reviewer", "tester"]);
    expect(result.stageResult.reasoning).toContain("Moderate complexity");
  });

  it("falls back to safe defaults when triage fails", async () => {
    triageRunMock.mockResolvedValue({
      ok: false,
      result: { error: "Agent failed" },
      summary: "Triage failed",
      usage: { tokens_in: 50, tokens_out: 20 }
    });

    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    // When ok is false, roleOverrides should be empty (no overrides applied)
    expect(result.roleOverrides).toEqual({});
    expect(result.stageResult.ok).toBe(false);
  });

  it("emits triage:start and triage:end events", async () => {
    const events = [];
    emitter.on("progress", (event) => events.push(event));

    await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    const startEvent = events.find((e) => e.type === "triage:start");
    const endEvent = events.find((e) => e.type === "triage:end");
    expect(startEvent).toBeTruthy();
    expect(endEvent).toBeTruthy();
    expect(endEvent.detail.level).toBe("medium");
    expect(endEvent.detail.roles).toEqual(["reviewer", "tester"]);
  });

  it("tracks budget after triage execution", async () => {
    await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(trackBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "triage",
        provider: "claude"
      })
    );
  });

  it("correctly maps all roles to enabled/disabled", async () => {
    triageRunMock.mockResolvedValue({
      ok: true,
      result: {
        level: "complex",
        roles: ["planner", "researcher", "refactorer", "reviewer", "tester", "security"],
        reasoning: "Full pipeline needed"
      },
      usage: { tokens_in: 120, tokens_out: 90 }
    });

    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.roleOverrides.plannerEnabled).toBe(true);
    expect(result.roleOverrides.researcherEnabled).toBe(true);
    expect(result.roleOverrides.refactorerEnabled).toBe(true);
    expect(result.roleOverrides.reviewerEnabled).toBe(true);
    expect(result.roleOverrides.testerEnabled).toBe(true);
    expect(result.roleOverrides.securityEnabled).toBe(true);
  });

  it("includes taskType in stage result", async () => {
    triageRunMock.mockResolvedValue({
      ok: true,
      result: {
        level: "simple",
        roles: ["reviewer"],
        reasoning: "Infra config.",
        taskType: "infra"
      },
      usage: { tokens_in: 100, tokens_out: 80 }
    });

    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.stageResult.taskType).toBe("infra");
  });

  it("defaults taskType to 'sw' when triage omits it", async () => {
    // Default mock has no taskType
    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.stageResult.taskType).toBe("sw");
  });

  it("defaults taskType to 'sw' when triage fails", async () => {
    triageRunMock.mockResolvedValue({
      ok: false,
      result: { error: "Agent failed" },
      summary: "Triage failed",
      usage: { tokens_in: 50, tokens_out: 20 }
    });

    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.stageResult.taskType).toBe("sw");
  });

  it("handles shouldDecompose in stage result", async () => {
    triageRunMock.mockResolvedValue({
      ok: true,
      result: {
        level: "complex",
        roles: ["planner", "reviewer"],
        reasoning: "Needs decomposition",
        shouldDecompose: true,
        subtasks: ["Part A", "Part B"]
      },
      usage: { tokens_in: 150, tokens_out: 100 }
    });

    const result = await runTriageStage({
      config, logger, emitter, eventBase, session,
      coderRole: { provider: "codex", model: null },
      trackBudget
    });

    expect(result.stageResult.shouldDecompose).toBe(true);
    expect(result.stageResult.subtasks).toEqual(["Part A", "Part B"]);
  });
});
