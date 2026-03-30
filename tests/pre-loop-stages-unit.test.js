import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Per-test overridable mock behaviors ---
// These are set in beforeEach and can be overridden per test before calling the stage function.

let triageRunFn, researcherRunFn, architectExecuteFn, plannerExecuteFn, huReviewerRunFn;

function resetRunFns() {
  triageRunFn = vi.fn(async () => ({
    ok: true,
    summary: "Triage completed",
    result: {
      level: "medium",
      roles: ["planner", "researcher"],
      reasoning: "task is medium complexity",
      taskType: "sw",
      shouldDecompose: false,
      subtasks: []
    }
  }));

  researcherRunFn = vi.fn(async () => ({
    ok: true, summary: "Research done", result: { context: "found relevant files" }
  }));

  architectExecuteFn = vi.fn(async () => ({
    ok: true, summary: "Architecture ready",
    result: { verdict: "ready", architecture: { approach: "modular" }, questions: [] }
  }));

  plannerExecuteFn = vi.fn(async () => ({
    ok: true, result: { plan: "Step 1: do X\nStep 2: do Y" }, summary: "Plan created"
  }));

  huReviewerRunFn = vi.fn(async () => ({
    ok: true, summary: "HU review done",
    result: {
      evaluations: [
        { story_id: "HU-AUTO-001", verdict: "certified", scores: { clarity: 5 }, certified_hu: { text: "certified version" } }
      ]
    }
  }));
}

// --- Module-level mocks ---

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.run = (...args) => triageRunFn(...args);
    }
  }
}));

vi.mock("../src/roles/researcher-role.js", () => ({
  ResearcherRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.run = (...args) => researcherRunFn(...args);
    }
  }
}));

vi.mock("../src/roles/planner-role.js", () => ({
  PlannerRole: class {
    constructor() {
      this.context = null;
      this.init = vi.fn(async () => {});
      this.execute = (...args) => plannerExecuteFn(...args);
    }
  }
}));

vi.mock("../src/roles/discover-role.js", () => ({
  DiscoverRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.run = vi.fn(async () => ({
        ok: true, summary: "Discover done", result: { verdict: "ready", gaps: [] }
      }));
    }
  }
}));

vi.mock("../src/roles/architect-role.js", () => ({
  ArchitectRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.execute = (...args) => architectExecuteFn(...args);
    }
  }
}));

vi.mock("../src/roles/hu-reviewer-role.js", () => ({
  HuReviewerRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.run = (...args) => huReviewerRunFn(...args);
    }
  }
}));

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({ ok: true, output: "agent output" }))
  }))
}));

vi.mock("../src/planning-game/architect-adrs.js", () => ({
  createArchitectADRs: vi.fn(async () => ({ created: 0 }))
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, data) => ({ type, ...base, ...data }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  parsePlannerOutput: vi.fn(() => ({
    title: "Plan Title",
    approach: "incremental",
    steps: [{ step: 1, desc: "do X" }]
  }))
}));

vi.mock("../src/prompts/hu-reviewer.js", () => ({
  buildDecompositionPrompt: vi.fn(() => "decompose prompt"),
  parseDecompositionOutput: vi.fn(() => null)
}));

vi.mock("../src/utils/model-selector.js", () => ({
  selectModelsForRoles: vi.fn(() => ({ modelOverrides: {}, reasoning: "default" }))
}));

vi.mock("../src/utils/stall-detector.js", () => ({
  createStallDetector: vi.fn(() => ({
    onOutput: vi.fn(),
    stop: vi.fn(),
    stats: () => ({ lineCount: 0, bytesReceived: 0, elapsedMs: 0 })
  }))
}));

vi.mock("../src/hu/store.js", () => ({
  createHuBatch: vi.fn(async (id, stories) => ({
    stories: stories.map(s => ({
      id: s.id, status: "pending", original: { text: s.text },
      blocked_by: s.blocked_by || [], certified: null, quality: null,
      context_requests: []
    }))
  })),
  loadHuBatch: vi.fn(async () => { throw new Error("no batch"); }),
  saveHuBatch: vi.fn(async () => {}),
  updateStoryStatus: vi.fn(),
  updateStoryQuality: vi.fn(),
  updateStoryCertified: vi.fn((batch, id, hu) => {
    const story = batch.stories.find(s => s.id === id);
    if (story) { story.status = "certified"; story.certified = hu; }
  }),
  addContextRequest: vi.fn(),
  answerContextRequest: vi.fn()
}));

vi.mock("../src/hu/graph.js", () => ({
  topologicalSort: vi.fn((stories) => stories.map(s => s.id))
}));

vi.mock("../src/hu/splitting-detector.js", () => ({
  detectIndicators: vi.fn(() => []),
  selectHeuristic: vi.fn(() => null)
}));

vi.mock("../src/hu/splitting-generator.js", () => ({
  generateSplitProposal: vi.fn(async () => null),
  formatSplitProposalForFDE: vi.fn(() => ""),
  buildSplitDependencies: vi.fn((subs) => subs)
}));

// --- Helpers ---

function makeSession(overrides = {}) {
  return {
    id: "session-001",
    task: "implement feature X",
    pg_task_id: null,
    pg_project_id: null,
    checkpoints: [],
    ...overrides
  };
}

function makeConfig(overrides = {}) {
  return {
    output: { log_level: "error" },
    roles: { coder: { provider: "claude" }, triage: {}, researcher: {}, architect: {}, planner: { provider: "claude" }, discover: {}, hu_reviewer: {} },
    pipeline: {},
    session: { max_iteration_minutes: 5 },
    model_selection: { enabled: false },
    ...overrides
  };
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const emitter = { emit: vi.fn() };
const eventBase = { sessionId: "session-001", iteration: 0, startedAt: Date.now() };
const coderRole = { provider: "claude", model: null };
const trackBudget = vi.fn();

// --- Tests ---

describe("pre-loop-stages: runTriageStage", () => {
  let runTriageStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runTriageStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("returns complexity classification on success", async () => {
    const { roleOverrides, stageResult } = await runTriageStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(true);
    expect(stageResult.level).toBe("medium");
    expect(stageResult.roles).toContain("planner");
    expect(stageResult.taskType).toBe("sw");
    expect(roleOverrides).toBeDefined();
  });

  it("handles triage failure gracefully", async () => {
    triageRunFn = vi.fn(async () => { throw new Error("agent crashed"); });

    const { stageResult } = await runTriageStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(false);
  });

  it("tracks budget", async () => {
    await runTriageStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });
    expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "triage" }));
  });
});

describe("pre-loop-stages: runResearcherStage", () => {
  let runResearcherStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runResearcherStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("returns research context on success", async () => {
    const { researchContext, stageResult } = await runResearcherStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(true);
    expect(researchContext).toEqual({ context: "found relevant files" });
  });

  it("handles researcher failure gracefully", async () => {
    researcherRunFn = vi.fn(async () => { throw new Error("researcher crashed"); });

    const { researchContext, stageResult } = await runResearcherStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(false);
    expect(researchContext).toBeNull();
  });
});

describe("pre-loop-stages: runArchitectStage", () => {
  let runArchitectStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runArchitectStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("returns architecture design on success", async () => {
    const { architectContext, stageResult } = await runArchitectStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(true);
    expect(stageResult.verdict).toBe("ready");
    expect(stageResult.architecture).toEqual({ approach: "modular" });
    expect(architectContext).toBeDefined();
  });

  it("handles architect failure gracefully", async () => {
    architectExecuteFn = vi.fn(async () => { throw new Error("architect crashed"); });

    const { architectContext, stageResult } = await runArchitectStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget
    });

    expect(stageResult.ok).toBe(false);
    expect(architectContext).toBeNull();
  });
});

describe("pre-loop-stages: runPlannerStage", () => {
  let runPlannerStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runPlannerStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("returns implementation plan on success", async () => {
    const plannerRole = { provider: "claude", model: null };
    const { plannedTask, stageResult } = await runPlannerStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), plannerRole, researchContext: null, trackBudget
    });

    expect(stageResult.ok).toBe(true);
    expect(stageResult.steps).toHaveLength(1);
    expect(plannedTask).toContain("implement feature X");
  });

  it("throws and marks session failed when planner fails", async () => {
    plannerExecuteFn = vi.fn(async () => ({
      ok: false, result: { error: "no plan" }, summary: "Planner error: no plan"
    }));

    const { markSessionStatus } = await import("../src/session-store.js");
    const plannerRole = { provider: "claude", model: null };

    await expect(
      runPlannerStage({
        config: makeConfig(), logger, emitter, eventBase,
        session: makeSession(), plannerRole, researchContext: null, trackBudget
      })
    ).rejects.toThrow(/planner failed/i);

    expect(markSessionStatus).toHaveBeenCalledWith(expect.anything(), "failed");
  });
});

describe("pre-loop-stages: runHuReviewerStage", () => {
  let runHuReviewerStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runHuReviewerStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("auto-generates single HU when no huFile and no PG stories", async () => {
    const { stageResult } = await runHuReviewerStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget,
      huFile: null, askQuestion: null, pgStories: null
    });

    expect(stageResult.ok).toBe(true);
    expect(stageResult.total).toBeGreaterThanOrEqual(1);
  });

  it("uses PG stories when provided", async () => {
    const pgStories = [
      { id: "PG-001", text: "As a user I want X" },
      { id: "PG-002", text: "As a user I want Y" }
    ];

    const { stageResult } = await runHuReviewerStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget,
      huFile: null, askQuestion: null, pgStories
    });

    expect(stageResult.ok).toBe(true);
    expect(stageResult.total).toBe(2);
  });

  it("returns error when huFile cannot be read", async () => {
    const { stageResult } = await runHuReviewerStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget,
      huFile: "/nonexistent/file.yml", askQuestion: null
    });

    expect(stageResult.ok).toBe(false);
    expect(stageResult.error).toMatch(/could not read/i);
  });
});

describe("pre-loop-stages: splitting detection", () => {
  let runHuReviewerStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRunFns();
    ({ runHuReviewerStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  it("triggers split flow when indicators are detected", async () => {
    const { detectIndicators, selectHeuristic } = await import("../src/hu/splitting-detector.js");
    const { generateSplitProposal, buildSplitDependencies } = await import("../src/hu/splitting-generator.js");

    detectIndicators.mockReturnValue(["conjunctions"]);
    selectHeuristic.mockReturnValue("workflow-steps");
    generateSplitProposal.mockResolvedValue({
      subHUs: [
        { id: "SUB-001", title: "Sub 1", text: "sub text 1", acceptanceCriteria: ["AC1"] },
        { id: "SUB-002", title: "Sub 2", text: "sub text 2", acceptanceCriteria: ["AC2"] }
      ]
    });
    buildSplitDependencies.mockReturnValue([
      { id: "SUB-001", title: "Sub 1", text: "sub text 1", acceptanceCriteria: ["AC1"], blocked_by: [] },
      { id: "SUB-002", title: "Sub 2", text: "sub text 2", acceptanceCriteria: ["AC2"], blocked_by: ["SUB-001"] }
    ]);

    const { stageResult } = await runHuReviewerStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), coderRole, trackBudget,
      huFile: null, askQuestion: null, pgStories: null
    });

    expect(stageResult.ok).toBe(true);
    expect(generateSplitProposal).toHaveBeenCalled();
  });
});
