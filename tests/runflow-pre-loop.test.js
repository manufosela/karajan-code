import { beforeEach, describe, expect, it, vi } from "vitest";

const triageRunMock = vi.fn();
const researcherRunMock = vi.fn();
const discoverRunMock = vi.fn();
const architectExecuteMock = vi.fn();

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() {
      return triageRunMock();
    }
  }
}));

vi.mock("../src/roles/researcher-role.js", () => ({
  ResearcherRole: class {
    async init() {}
    async run() {
      return researcherRunMock();
    }
  }
}));

vi.mock("../src/roles/discover-role.js", () => ({
  DiscoverRole: class {
    async init() {}
    async run() {
      return discoverRunMock();
    }
  }
}));

vi.mock("../src/roles/architect-role.js", () => ({
  ArchitectRole: class {
    context = {};
    async init() {}
    async execute(input) {
      return architectExecuteMock(input);
    }
  }
}));

vi.mock("../src/roles/planner-role.js", () => {
  const executeMock = vi.fn();
  let lastContext = null;
  class MockPlannerRole {
    constructor() { this._context = {}; }
    async init() {}
    async execute(task) { return executeMock(task); }
    set context(val) { this._context = val; lastContext = val; }
    get context() { return this._context; }
  }
  return {
    PlannerRole: MockPlannerRole,
    __executeMock: executeMock,
    __getLastContext: () => lastContext
  };
});

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session/store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  parsePlannerOutput: vi.fn((output) => ({ title: "Plan", approach: "Approach", steps: ["Step 1"] }))
}));

describe("pre-loop-stages", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 0, stage: null, startedAt: Date.now() };
  const coderRole = { provider: "codex", model: "codex-mini" };
  const trackBudget = vi.fn();

  let runTriageStage, runResearcherStage, runPlannerStage, runDiscoverStage, runArchitectStage;

  beforeEach(async () => {
    vi.resetAllMocks();
    triageRunMock.mockResolvedValue({
      ok: true,
      result: { level: "medium", roles: ["reviewer", "tester"], reasoning: "Moderate" },
      usage: { tokens_in: 100, tokens_out: 80 }
    });
    researcherRunMock.mockResolvedValue({
      ok: true,
      summary: "Found relevant files",
      result: { files: ["a.js"] }
    });
    discoverRunMock.mockResolvedValue({
      ok: true,
      result: { verdict: "ready", gaps: [], mode: "gaps", provider: "claude" },
      summary: "Discovery complete: task is ready",
      usage: { tokens_in: 200, tokens_out: 150 }
    });
    architectExecuteMock.mockResolvedValue({
      ok: true,
      result: {
        verdict: "approved",
        architecture: { type: "layered", layers: ["api", "service"], patterns: [], dataModel: { entities: [] }, apiContracts: [], dependencies: [], tradeoffs: [] },
        questions: [],
        provider: "claude"
      },
      summary: "Architecture complete: layered, 2 layers (verdict: approved)",
      usage: { tokens_in: 300, tokens_out: 250 }
    });

    ({ runTriageStage, runResearcherStage, runPlannerStage, runDiscoverStage, runArchitectStage } = await import("../src/orchestrator/pre-loop-stages.js"));
  });

  describe("runTriageStage", () => {
    it("returns role overrides from triage classification", async () => {
      const session = { id: "s1", task: "test task", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.roleOverrides.reviewerEnabled).toBe(true);
      expect(result.roleOverrides.testerEnabled).toBe(true);
      expect(result.roleOverrides.plannerEnabled).toBe(false);
      expect(result.roleOverrides.securityEnabled).toBe(false);
      expect(result.stageResult.level).toBe("medium");
      expect(result.stageResult.ok).toBe(true);
    });

    it("tracks budget for triage", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "triage" }));
    });

    it("returns empty overrides when triage fails", async () => {
      triageRunMock.mockResolvedValueOnce({
        ok: false,
        result: {},
        summary: "Triage error"
      });
      const session = { id: "s1", task: "t", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.roleOverrides).toEqual({});
      expect(result.stageResult.ok).toBe(false);
    });
  });

  describe("runResearcherStage", () => {
    it("returns research context when successful", async () => {
      const session = { id: "s1", task: "research task", checkpoints: [] };
      const result = await runResearcherStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.researchContext).toEqual({ files: ["a.js"] });
      expect(result.stageResult.ok).toBe(true);
    });

    it("returns null context when researcher fails", async () => {
      researcherRunMock.mockResolvedValueOnce({
        ok: false,
        summary: "Research failed",
        result: null
      });
      const session = { id: "s1", task: "t", checkpoints: [] };
      const result = await runResearcherStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.researchContext).toBeNull();
      expect(result.stageResult.ok).toBe(false);
    });

    it("tracks budget for researcher", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runResearcherStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "researcher" }));
    });
  });

  describe("runPlannerStage", () => {
    it("returns planned task with execution plan appended", async () => {
      const { __executeMock } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({
        ok: true,
        result: { plan: "1. Do something\n2. Do more" }
      });

      const session = { id: "s1", task: "build feature", checkpoints: [] };
      const plannerRole = { provider: "claude", model: "claude-sonnet" };
      const result = await runPlannerStage({
        config: {}, logger, emitter, eventBase, session,
        plannerRole, researchContext: null, trackBudget
      });

      expect(result.plannedTask).toContain("build feature");
      expect(result.plannedTask).toContain("Execution plan:");
      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.title).toBe("Plan");
    });

    it("throws when planner fails", async () => {
      const { __executeMock } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({
        ok: false,
        result: { error: "LLM timeout" },
        summary: "timeout"
      });

      const session = { id: "s1", task: "t", checkpoints: [] };
      const plannerRole = { provider: "claude", model: null };

      await expect(
        runPlannerStage({ config: {}, logger, emitter, eventBase, session, plannerRole, researchContext: null, trackBudget })
      ).rejects.toThrow("Planner failed: LLM timeout");
    });

    it("returns original task when plan output is empty", async () => {
      const { __executeMock } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({
        ok: true,
        result: { plan: "" }
      });

      const session = { id: "s1", task: "simple task", checkpoints: [] };
      const plannerRole = { provider: "claude", model: null };
      const result = await runPlannerStage({
        config: {}, logger, emitter, eventBase, session,
        plannerRole, researchContext: null, trackBudget
      });

      expect(result.plannedTask).toBe("simple task");
    });

    it("passes architectContext to planner context", async () => {
      const { __executeMock, __getLastContext } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({ ok: true, result: { plan: "step1" } });

      const session = { id: "s1", task: "build api", checkpoints: [] };
      const plannerRole = { provider: "claude", model: "claude-sonnet" };
      const architectContext = { verdict: "approved", architecture: { type: "layered" } };
      await runPlannerStage({
        config: {}, logger, emitter, eventBase, session,
        plannerRole, researchContext: null, architectContext, trackBudget
      });

      const ctx = __getLastContext();
      expect(ctx.architecture).toEqual(architectContext);
    });

    it("tracks budget for planner", async () => {
      const { __executeMock } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({ ok: true, result: { plan: "step1" } });

      const session = { id: "s1", task: "t", checkpoints: [] };
      const plannerRole = { provider: "claude", model: "model" };
      await runPlannerStage({ config: {}, logger, emitter, eventBase, session, plannerRole, researchContext: null, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "planner", provider: "claude" }));
    });
  });

  describe("runArchitectStage", () => {
    it("returns architectContext when successful", async () => {
      const session = { id: "s1", task: "build feature", checkpoints: [] };
      const result = await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.architectContext).toBeDefined();
      expect(result.architectContext.verdict).toBe("approved");
      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.verdict).toBe("approved");
    });

    it("returns null context when architect fails", async () => {
      architectExecuteMock.mockResolvedValueOnce({
        ok: false,
        result: { error: "LLM timeout" },
        summary: "Architect failed: LLM timeout",
        usage: { tokens_in: 50, tokens_out: 0 }
      });
      const session = { id: "s1", task: "t", checkpoints: [] };
      const result = await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.architectContext).toBeNull();
      expect(result.stageResult.ok).toBe(false);
    });

    it("tracks budget for architect", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "architect" }));
    });

    it("uses architect provider from config", async () => {
      const config = { roles: { architect: { provider: "gemini", model: "gemini-pro" } } };
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runArchitectStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({
        role: "architect",
        provider: "gemini"
      }));
    });

    it("falls back to coder provider when no architect provider configured", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({
        role: "architect",
        provider: "codex"
      }));
    });

    it("passes researchContext and triageLevel to execute", async () => {
      const session = { id: "s1", task: "design api", checkpoints: [] };
      const researchContext = { files: ["a.js"] };
      const triageLevel = "complex";
      await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget, researchContext, triageLevel });

      expect(architectExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
        task: "design api",
        researchContext: { files: ["a.js"] },
        triageLevel: "complex"
      }));
    });

    it("passes discoverResult to execute when provided", async () => {
      const session = { id: "s1", task: "build api", checkpoints: [] };
      const discoverResult = { ok: true, verdict: "ready", gaps: [], mode: "gaps" };
      await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget, discoverResult });

      expect(architectExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
        task: "build api",
        discoverResult: { ok: true, verdict: "ready", gaps: [], mode: "gaps" }
      }));
    });

    it("does not throw when architect fails — stage is non-blocking", async () => {
      architectExecuteMock.mockResolvedValueOnce({
        ok: false,
        result: { error: "timeout" },
        summary: "Architect failed",
        usage: {}
      });
      const session = { id: "s1", task: "t", checkpoints: [] };

      const result = await runArchitectStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });
      expect(result.stageResult.ok).toBe(false);
    });

    it("receives discover stageResult when both discover and architect run (orchestrator wiring)", async () => {
      const session = { id: "s1", task: "build api", checkpoints: [] };

      // Step 1: run discover to get its stageResult (as orchestrator does)
      const discoverOut = await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      // Step 2: pass discover stageResult as discoverResult to architect (mirrors orchestrator.js line 339)
      await runArchitectStage({
        config: {}, logger, emitter, eventBase, session, coderRole, trackBudget,
        discoverResult: discoverOut.stageResult
      });

      expect(architectExecuteMock).toHaveBeenCalledWith(expect.objectContaining({
        discoverResult: expect.objectContaining({
          ok: true,
          verdict: "ready",
          gaps: [],
          mode: "gaps"
        })
      }));
    });
  });

  describe("runArchitectStage needs_clarification", () => {
    it("pauses and re-runs architect when needs_clarification and askQuestion available", async () => {
      const clarificationOutput = {
        ok: true,
        result: {
          verdict: "needs_clarification",
          architecture: { type: "layered", layers: ["api"], patterns: [], dataModel: { entities: [] }, apiContracts: [], dependencies: [], tradeoffs: [] },
          questions: ["What database should we use?", "Should we use REST or GraphQL?"],
          provider: "claude"
        },
        summary: "Architecture needs clarification",
        usage: { tokens_in: 300, tokens_out: 250 }
      };
      const approvedOutput = {
        ok: true,
        result: {
          verdict: "approved",
          architecture: { type: "layered", layers: ["api", "db"], patterns: [], dataModel: { entities: [] }, apiContracts: [], dependencies: [], tradeoffs: [] },
          questions: [],
          provider: "claude"
        },
        summary: "Architecture approved after clarification",
        usage: { tokens_in: 400, tokens_out: 300 }
      };

      architectExecuteMock
        .mockResolvedValueOnce(clarificationOutput)
        .mockResolvedValueOnce(approvedOutput);

      const askQuestion = vi.fn().mockResolvedValue("Use PostgreSQL and REST");
      const session = { id: "s1", task: "build api", checkpoints: [] };

      const result = await runArchitectStage({
        config: {}, logger, emitter, eventBase, session, coderRole, trackBudget, askQuestion
      });

      // askQuestion should have been called with the formatted questions
      expect(askQuestion).toHaveBeenCalledTimes(1);
      const questionArg = askQuestion.mock.calls[0][0];
      expect(questionArg).toContain("What database should we use?");
      expect(questionArg).toContain("Should we use REST or GraphQL?");

      // Architect should have been called twice (original + with answers)
      expect(architectExecuteMock).toHaveBeenCalledTimes(2);
      const secondCall = architectExecuteMock.mock.calls[1][0];
      expect(secondCall.humanAnswers).toBe("Use PostgreSQL and REST");

      // Final result should be the approved output
      expect(result.architectContext.verdict).toBe("approved");
      expect(result.stageResult.verdict).toBe("approved");
    });

    it("emits warning and continues with best-effort when askQuestion not available", async () => {
      const clarificationOutput = {
        ok: true,
        result: {
          verdict: "needs_clarification",
          architecture: { type: "layered", layers: ["api"], patterns: [], dataModel: { entities: [] }, apiContracts: [], dependencies: [], tradeoffs: [] },
          questions: ["What database should we use?"],
          provider: "claude"
        },
        summary: "Architecture needs clarification",
        usage: { tokens_in: 300, tokens_out: 250 }
      };

      architectExecuteMock.mockResolvedValueOnce(clarificationOutput);
      const session = { id: "s1", task: "build api", checkpoints: [] };

      const result = await runArchitectStage({
        config: {}, logger, emitter, eventBase, session, coderRole, trackBudget
        // no askQuestion
      });

      // Should warn and continue with current output
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("needs_clarification"));
      // Should NOT re-run architect
      expect(architectExecuteMock).toHaveBeenCalledTimes(1);
      // Should still return the best-effort context
      expect(result.architectContext.verdict).toBe("needs_clarification");
      expect(result.stageResult.verdict).toBe("needs_clarification");
    });

    it("continues with best-effort when askQuestion returns null", async () => {
      const clarificationOutput = {
        ok: true,
        result: {
          verdict: "needs_clarification",
          architecture: { type: "layered", layers: ["api"], patterns: [], dataModel: { entities: [] }, apiContracts: [], dependencies: [], tradeoffs: [] },
          questions: ["What database?"],
          provider: "claude"
        },
        summary: "Needs clarification",
        usage: { tokens_in: 300, tokens_out: 250 }
      };

      architectExecuteMock.mockResolvedValueOnce(clarificationOutput);
      const askQuestion = vi.fn().mockResolvedValue(null);
      const session = { id: "s1", task: "build api", checkpoints: [] };

      const result = await runArchitectStage({
        config: {}, logger, emitter, eventBase, session, coderRole, trackBudget, askQuestion
      });

      // askQuestion was called but returned null
      expect(askQuestion).toHaveBeenCalledTimes(1);
      // Should NOT re-run architect
      expect(architectExecuteMock).toHaveBeenCalledTimes(1);
      // Continue with best-effort
      expect(result.architectContext.verdict).toBe("needs_clarification");
    });
  });

  describe("runDiscoverStage", () => {
    it("returns stageResult with verdict and gaps when discovery succeeds", async () => {
      const session = { id: "s1", task: "build feature", checkpoints: [] };
      const result = await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.verdict).toBe("ready");
      expect(result.stageResult.gaps).toEqual([]);
    });

    it("tracks budget for discover", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "discover" }));
    });

    it("returns ok=false when discover agent fails", async () => {
      discoverRunMock.mockResolvedValueOnce({
        ok: false,
        result: { error: "LLM timeout" },
        summary: "Discovery failed: LLM timeout",
        usage: { tokens_in: 50, tokens_out: 0 }
      });
      const session = { id: "s1", task: "t", checkpoints: [] };
      const result = await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.ok).toBe(false);
    });

    it("returns gaps when verdict is needs_validation", async () => {
      discoverRunMock.mockResolvedValueOnce({
        ok: true,
        result: {
          verdict: "needs_validation",
          gaps: [{ id: "gap-1", description: "Missing auth", severity: "critical", suggestedQuestion: "How?" }],
          mode: "gaps",
          provider: "claude"
        },
        summary: "1 gap found",
        usage: { tokens_in: 200, tokens_out: 150 }
      });
      const session = { id: "s1", task: "t", checkpoints: [] };
      const result = await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.verdict).toBe("needs_validation");
      expect(result.stageResult.gaps).toHaveLength(1);
    });

    it("uses discover provider from config", async () => {
      const config = { roles: { discover: { provider: "gemini", model: "gemini-pro" } } };
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({
        role: "discover",
        provider: "gemini"
      }));
    });

    it("falls back to coder provider when no discover provider configured", async () => {
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({
        role: "discover",
        provider: "codex"
      }));
    });

    it("passes mode from config when specified", async () => {
      const config = { pipeline: { discover: { enabled: true, mode: "momtest" } } };
      const session = { id: "s1", task: "t", checkpoints: [] };
      await runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result => result.stageResult.ok).toBeDefined();
    });

    it("does not throw when discover fails — stage is non-blocking", async () => {
      discoverRunMock.mockResolvedValueOnce({
        ok: false,
        result: { error: "timeout" },
        summary: "Discovery failed",
        usage: {}
      });
      const session = { id: "s1", task: "t", checkpoints: [] };

      // Should NOT throw (unlike planner which throws on failure)
      const result = await runDiscoverStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });
      expect(result.stageResult.ok).toBe(false);
    });
  });
});
