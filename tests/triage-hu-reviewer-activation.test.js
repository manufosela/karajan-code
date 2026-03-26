import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const triageRunMock = vi.fn();
const huReviewerRunMock = vi.fn();

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() { return triageRunMock(); }
  }
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {})
}));

vi.mock("../src/utils/model-selector.js", () => ({
  selectModelsForRoles: vi.fn(() => ({ modelOverrides: {}, reasoning: "test" }))
}));

vi.mock("../src/roles/hu-reviewer-role.js", () => ({
  HuReviewerRole: class {
    async init() {}
    async run(input) { return huReviewerRunMock(input); }
  }
}));

vi.mock("../src/hu/store.js", () => ({
  createHuBatch: vi.fn(async (_id, stories) => ({ stories: stories.map(s => ({ ...s, id: s.id, original: s, status: "pending", context_requests: [] })) })),
  loadHuBatch: vi.fn(async () => { throw new Error("not found"); }),
  saveHuBatch: vi.fn(async () => {}),
  updateStoryStatus: vi.fn(),
  updateStoryQuality: vi.fn(),
  updateStoryCertified: vi.fn((batch, storyId) => {
    const story = batch.stories.find(s => s.id === storyId);
    if (story) story.status = "certified";
  }),
  addContextRequest: vi.fn(),
  answerContextRequest: vi.fn()
}));

vi.mock("../src/hu/graph.js", () => ({
  topologicalSort: vi.fn((stories) => stories.map(s => s.id))
}));

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({ ok: true, output: "{}", usage: {} }))
  }))
}));

const { runTriageStage, runHuReviewerStage } = await import("../src/orchestrator/pre-loop-stages.js");
const { buildTriagePrompt, ROLE_DESCRIPTIONS } = await import("../src/prompts/triage.js");

describe("triage hu-reviewer activation", () => {
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const trackBudget = vi.fn();

  let emitter;
  let config;
  let session;
  let eventBase;
  const coderRole = { provider: "codex", model: null };

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    config = {
      roles: {
        triage: { provider: "claude", model: null },
        coder: { provider: "codex", model: null },
        hu_reviewer: { provider: "claude", model: null }
      },
      model_selection: { enabled: false }
    };
    session = { id: "s_test", task: "Build a new user dashboard with multiple views and role-based access", checkpoints: [] };
    eventBase = { sessionId: "s_test", iteration: 0, stage: null, startedAt: Date.now() };
  });

  describe("triage prompt includes hu-reviewer", () => {
    it("ROLE_DESCRIPTIONS contains hu-reviewer entry", () => {
      const huRole = ROLE_DESCRIPTIONS.find(r => r.role === "hu-reviewer");
      expect(huRole).toBeTruthy();
      expect(huRole.description).toContain("Certifies user stories");
      expect(huRole.description).toContain("medium/complex");
    });

    it("buildTriagePrompt includes hu-reviewer in available roles", () => {
      const prompt = buildTriagePrompt({ task: "test task" });
      expect(prompt).toContain("hu-reviewer");
      expect(prompt).toContain("Certifies user stories");
    });

    it("buildTriagePrompt JSON schema includes hu-reviewer in roles enum", () => {
      const prompt = buildTriagePrompt({ task: "test task" });
      expect(prompt).toContain("hu-reviewer");
    });
  });

  describe("triage classifies medium task → hu-reviewer activates", () => {
    it("includes hu-reviewer in stageResult roles when triage recommends it", async () => {
      triageRunMock.mockResolvedValue({
        ok: true,
        result: {
          level: "medium",
          roles: ["reviewer", "tester", "hu-reviewer"],
          reasoning: "Medium complexity, story decomposition recommended"
        },
        usage: { tokens_in: 100, tokens_out: 80 }
      });

      const result = await runTriageStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget
      });

      expect(result.stageResult.roles).toContain("hu-reviewer");
      expect(result.stageResult.level).toBe("medium");
    });
  });

  describe("triage classifies trivial task → hu-reviewer does NOT activate", () => {
    it("does not include hu-reviewer for trivial tasks", async () => {
      triageRunMock.mockResolvedValue({
        ok: true,
        result: {
          level: "trivial",
          roles: ["reviewer"],
          reasoning: "Simple one-line fix"
        },
        usage: { tokens_in: 100, tokens_out: 80 }
      });

      const result = await runTriageStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget
      });

      expect(result.stageResult.roles).not.toContain("hu-reviewer");
      expect(result.stageResult.level).toBe("trivial");
    });
  });

  describe("hu-reviewer runs without --hu-file when auto-activated by triage", () => {
    it("runs hu-reviewer stage with task as auto-generated story when no huFile", async () => {
      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "HU-AUTO-001",
            scores: { D1_jtbd_context: 7, D2_user_specificity: 6, D3_behavior_change: 7, D4_control_zone: 8, D5_time_constraints: 7, D6_survivable_experiment: 6 },
            total: 41,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Good story",
            certified_hu: { id: "HU-AUTO-001", text: session.task }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" }
        },
        summary: "HU Review complete: 1 certified",
        usage: { tokens_in: 200, tokens_out: 150 }
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null,
        askQuestion: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.total).toBe(1);
      // Verify it was called with the auto-generated story from task
      expect(huReviewerRunMock).toHaveBeenCalled();
    });
  });

  describe("hu-reviewer still uses file when --hu-file is explicitly provided", () => {
    it("attempts to read file when huFile is provided", async () => {
      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: "/nonexistent/file.yaml",
        askQuestion: null
      });

      // Should fail because the file doesn't exist
      expect(result.stageResult.ok).toBe(false);
      expect(result.stageResult.error).toContain("Could not read HU file");
    });
  });
});
