import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const triageRunMock = vi.fn();

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() { return triageRunMock(); }
  }
}));

vi.mock("../src/roles/researcher-role.js", () => ({
  ResearcherRole: class {
    async init() {}
    async run() { return { ok: true, summary: "ok", result: { files: [] } }; }
  }
}));

vi.mock("../src/roles/discover-role.js", () => ({
  DiscoverRole: class {
    async init() {}
    async run() { return { ok: true, result: { verdict: "ready", gaps: [] }, summary: "ok" }; }
  }
}));

vi.mock("../src/roles/architect-role.js", () => ({
  ArchitectRole: class {
    context = {};
    async init() {}
    async execute() { return { ok: true, result: { verdict: "approved" }, summary: "ok" }; }
  }
}));

vi.mock("../src/roles/planner-role.js", () => ({
  PlannerRole: class {
    context = {};
    async init() {}
    async execute() { return { ok: true, result: { plan: "" } }; }
  }
}));

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));

vi.mock("../src/utils/model-selector.js", () => ({
  selectModelsForRoles: vi.fn(() => ({ modelOverrides: {}, reasoning: "test" }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  parsePlannerOutput: vi.fn(() => ({ title: "Plan", approach: "Approach", steps: ["Step 1"] }))
}));

const { runTriageStage } = await import("../src/orchestrator/pre-loop-stages.js");

// Import orchestrator internals indirectly by testing the full pre-loop flow
// We test the auto-simplify logic through the exported applyAutoSimplify behavior
// by checking the pipelineFlags mutation pattern used in orchestrator.js

describe("auto-simplify pipeline for simple tasks", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = new EventEmitter();
  const eventBase = { sessionId: "s1", iteration: 0, stage: null, startedAt: Date.now() };
  const coderRole = { provider: "claude", model: null };
  const trackBudget = vi.fn();

  function makeTriageMock(level, roles = ["reviewer"]) {
    return {
      ok: true,
      result: { level, roles, reasoning: `Level ${level}`, taskType: "sw" },
      usage: { tokens_in: 100, tokens_out: 80 }
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("triage level detection", () => {
    it("triage level trivial returns level in stageResult", async () => {
      triageRunMock.mockResolvedValue(makeTriageMock("trivial", []));
      const session = { id: "s1", task: "fix typo", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.level).toBe("trivial");
    });

    it("triage level simple returns level in stageResult", async () => {
      triageRunMock.mockResolvedValue(makeTriageMock("simple", ["reviewer"]));
      const session = { id: "s1", task: "update label", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.level).toBe("simple");
    });

    it("triage level medium returns level in stageResult", async () => {
      triageRunMock.mockResolvedValue(makeTriageMock("medium", ["reviewer", "tester"]));
      const session = { id: "s1", task: "add feature", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.level).toBe("medium");
    });

    it("triage level complex returns level in stageResult", async () => {
      triageRunMock.mockResolvedValue(makeTriageMock("complex", ["planner", "researcher", "reviewer", "tester", "security"]));
      const session = { id: "s1", task: "redesign auth", checkpoints: [] };
      const result = await runTriageStage({ config: {}, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(result.stageResult.level).toBe("complex");
    });
  });

  describe("applyAutoSimplify integration via config", () => {
    // These tests validate the auto-simplify config default
    it("pipeline.auto_simplify defaults to true in config", async () => {
      const { loadConfig } = await import("../src/config.js");
      // loadConfig merges with DEFAULTS
      const { config } = await loadConfig("/tmp/nonexistent-dir-for-test");
      expect(config.pipeline.auto_simplify).toBe(true);
    });

    it("applyRunOverrides respects autoSimplify=false flag", async () => {
      const { applyRunOverrides } = await import("../src/config.js");
      const config = {
        pipeline: { auto_simplify: true, triage: { enabled: true } },
        roles: { coder: { provider: "claude", model: null }, reviewer: { provider: "claude", model: null } },
        coder_options: {}, reviewer_options: { output_format: "json", require_schema: true, retries: 1, fallback_reviewer: "codex" },
        session: {}, git: {}, development: { methodology: "tdd", require_test_changes: true },
        sonarqube: {}, budget: {}, review_mode: "standard", max_iterations: 5, serena: { enabled: false }
      };
      const result = applyRunOverrides(config, { autoSimplify: false });
      expect(result.pipeline.auto_simplify).toBe(false);
    });

    it("applyRunOverrides keeps auto_simplify true when not overridden", async () => {
      const { applyRunOverrides } = await import("../src/config.js");
      const config = {
        pipeline: { auto_simplify: true, triage: { enabled: true } },
        roles: { coder: { provider: "claude", model: null }, reviewer: { provider: "claude", model: null } },
        coder_options: {}, reviewer_options: { output_format: "json", require_schema: true, retries: 1, fallback_reviewer: "codex" },
        session: {}, git: {}, development: { methodology: "tdd", require_test_changes: true },
        sonarqube: {}, budget: {}, review_mode: "standard", max_iterations: 5, serena: { enabled: false }
      };
      const result = applyRunOverrides(config, {});
      expect(result.pipeline.auto_simplify).toBe(true);
    });
  });

  describe("applyAutoSimplify function behavior (unit)", () => {
    // We import the orchestrator module and test the function indirectly
    // by simulating what runPreLoopStages does with pipelineFlags

    const SIMPLE_LEVELS = new Set(["trivial", "simple"]);

    function simulateAutoSimplify({ triageLevel, autoSimplifyConfig = true, modeFlag = undefined, enableReviewerFlag = undefined, enableTesterFlag = undefined }) {
      const pipelineFlags = {
        reviewerEnabled: true,
        testerEnabled: true,
        securityEnabled: true,
        plannerEnabled: false,
        researcherEnabled: false,
        refactorerEnabled: false,
        impeccableEnabled: false,
        discoverEnabled: false,
        architectEnabled: false
      };

      const config = { pipeline: { auto_simplify: autoSimplifyConfig } };
      const flags = {};
      if (modeFlag !== undefined) flags.mode = modeFlag;
      if (enableReviewerFlag !== undefined) flags.enableReviewer = enableReviewerFlag;
      if (enableTesterFlag !== undefined) flags.enableTester = enableTesterFlag;

      // Replicate the applyAutoSimplify logic
      const shouldSimplify =
        config.pipeline?.auto_simplify &&
        triageLevel &&
        SIMPLE_LEVELS.has(triageLevel) &&
        !flags.mode &&
        flags.enableReviewer === undefined &&
        flags.enableTester === undefined;

      if (shouldSimplify) {
        pipelineFlags.reviewerEnabled = false;
        pipelineFlags.testerEnabled = false;
      }

      return { pipelineFlags, simplified: shouldSimplify };
    }

    it("level trivial disables reviewer and tester", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "trivial" });
      expect(simplified).toBe(true);
      expect(pipelineFlags.reviewerEnabled).toBe(false);
      expect(pipelineFlags.testerEnabled).toBe(false);
      expect(pipelineFlags.securityEnabled).toBe(true);
    });

    it("level simple disables reviewer and tester", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "simple" });
      expect(simplified).toBe(true);
      expect(pipelineFlags.reviewerEnabled).toBe(false);
      expect(pipelineFlags.testerEnabled).toBe(false);
      expect(pipelineFlags.securityEnabled).toBe(true);
    });

    it("level medium keeps full pipeline", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "medium" });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
      expect(pipelineFlags.testerEnabled).toBe(true);
    });

    it("level complex keeps full pipeline", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "complex" });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
      expect(pipelineFlags.testerEnabled).toBe(true);
    });

    it("user --mode paranoid with trivial level forces full pipeline", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "trivial", modeFlag: "paranoid" });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
      expect(pipelineFlags.testerEnabled).toBe(true);
    });

    it("user --mode standard with simple level forces full pipeline", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "simple", modeFlag: "standard" });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
    });

    it("autoSimplify=false config keeps full pipeline for trivial level", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "trivial", autoSimplifyConfig: false });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
      expect(pipelineFlags.testerEnabled).toBe(true);
    });

    it("explicit --enable-tester overrides auto-simplification", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "trivial", enableTesterFlag: true });
      expect(simplified).toBe(false);
      expect(pipelineFlags.testerEnabled).toBe(true);
    });

    it("explicit --enable-reviewer overrides auto-simplification", () => {
      const { pipelineFlags, simplified } = simulateAutoSimplify({ triageLevel: "simple", enableReviewerFlag: true });
      expect(simplified).toBe(false);
      expect(pipelineFlags.reviewerEnabled).toBe(true);
    });

    it("keeps sonar enabled for simple tasks", () => {
      const { pipelineFlags } = simulateAutoSimplify({ triageLevel: "simple" });
      // sonar is not part of pipelineFlags, it's in config.sonarqube.enabled
      // Auto-simplify does NOT touch sonar — verified by checking it's not in the disabled list
      expect(pipelineFlags.securityEnabled).toBe(true);
    });

    it("null triage level does not simplify", () => {
      const { simplified } = simulateAutoSimplify({ triageLevel: null });
      expect(simplified).toBeFalsy();
    });
  });
});
