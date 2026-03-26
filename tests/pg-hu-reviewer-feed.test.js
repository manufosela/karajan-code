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
  createHuBatch: vi.fn(async (_id, stories) => ({
    stories: stories.map(s => ({
      ...s,
      id: s.id,
      original: s,
      status: "pending",
      context_requests: []
    }))
  })),
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

const { runHuReviewerStage } = await import("../src/orchestrator/pre-loop-stages.js");
const { buildHuStoriesFromPgCard } = await import("../src/planning-game/pipeline-adapter.js");

describe("PG card feeds HU reviewer", () => {
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
    session = { id: "s_test_pg", task: "Implement feature X", checkpoints: [] };
    eventBase = { sessionId: "s_test_pg", iteration: 0, stage: null, startedAt: Date.now() };
  });

  describe("buildHuStoriesFromPgCard", () => {
    it("converts PG card with descriptionStructured into HU stories", () => {
      const pgCard = {
        cardId: "KJC-TSK-0188",
        descriptionStructured: [
          { role: "a developer", goal: "feed PG data to hu-reviewer", benefit: "stories are pre-built from structured card data" }
        ],
        acceptanceCriteriaStructured: [
          { given: "a PG card with descriptionStructured", when: "hu-reviewer runs", then: "it uses PG data instead of auto-generating" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].id).toBe("KJC-TSK-0188");
      expect(stories[0].text).toContain("As a developer");
      expect(stories[0].text).toContain("feed PG data to hu-reviewer");
      expect(stories[0].text).toContain("stories are pre-built from structured card data");
      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Given a PG card with descriptionStructured");
      expect(stories[0].text).toContain("When hu-reviewer runs");
      expect(stories[0].text).toContain("Then it uses PG data instead of auto-generating");
    });

    it("returns null when PG card has no descriptionStructured", () => {
      const pgCard = {
        cardId: "KJC-TSK-0100",
        description: "Plain text description",
        title: "Some task"
      };

      const stories = buildHuStoriesFromPgCard(pgCard);
      expect(stories).toBeNull();
    });

    it("returns null for null or undefined card", () => {
      expect(buildHuStoriesFromPgCard(null)).toBeNull();
      expect(buildHuStoriesFromPgCard(undefined)).toBeNull();
    });

    it("includes plain acceptanceCriteria string when no structured AC", () => {
      const pgCard = {
        cardId: "KJC-TSK-0200",
        descriptionStructured: [
          { role: "a user", goal: "see the dashboard", benefit: "I can monitor metrics" }
        ],
        acceptanceCriteria: "- Dashboard loads within 2s\n- Shows 5 widgets"
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Dashboard loads within 2s");
    });

    it("handles multiple descriptionStructured entries", () => {
      const pgCard = {
        cardId: "KJC-TSK-0201",
        descriptionStructured: [
          { role: "an admin", goal: "manage users", benefit: "team stays organized" },
          { role: "a viewer", goal: "see reports", benefit: "I stay informed" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].text).toContain("As an admin");
      expect(stories[0].text).toContain("As a viewer");
    });

    it("handles acceptanceCriteriaStructured with raw entries", () => {
      const pgCard = {
        cardId: "KJC-TSK-0202",
        descriptionStructured: [
          { role: "a dev", goal: "run tests", benefit: "code quality stays high" }
        ],
        acceptanceCriteriaStructured: [
          { raw: "All tests must pass" },
          { given: "test suite", when: "run", then: "zero failures" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);
      expect(stories[0].text).toContain("- All tests must pass");
      expect(stories[0].text).toContain("Given test suite");
    });
  });

  describe("runHuReviewerStage with pgStories", () => {
    it("uses PG stories when pgStories is provided", async () => {
      const pgStories = [{ id: "KJC-TSK-0188", text: "As a developer, I want X so that Y." }];

      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "KJC-TSK-0188",
            scores: { D1_jtbd_context: 8, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 8, D5_time_constraints: 7, D6_survivable_experiment: 7 },
            total: 44,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Good PG-sourced story",
            certified_hu: { id: "KJC-TSK-0188", text: "As a developer, I want X so that Y." }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0 }
        },
        summary: "HU Review complete: 1 certified",
        usage: { tokens_in: 200, tokens_out: 150 }
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null, askQuestion: null, pgStories
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.certified).toBe(1);
      expect(result.stageResult.total).toBe(1);

      // Verify hu-reviewer was called with the PG story text
      expect(huReviewerRunMock).toHaveBeenCalled();
      const callArg = huReviewerRunMock.mock.calls[0][0];
      expect(callArg.stories[0].id).toBe("KJC-TSK-0188");
      expect(callArg.stories[0].text).toContain("As a developer");
    });

    it("falls back to auto-generation when pgStories is null", async () => {
      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "HU-AUTO-001",
            scores: { D1_jtbd_context: 6, D2_user_specificity: 5, D3_behavior_change: 6, D4_control_zone: 7, D5_time_constraints: 6, D6_survivable_experiment: 5 },
            total: 35,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Auto-generated from task",
            certified_hu: { id: "HU-AUTO-001", text: session.task }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0 }
        },
        summary: "HU Review complete: 1 certified",
        usage: { tokens_in: 200, tokens_out: 150 }
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null, askQuestion: null, pgStories: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(huReviewerRunMock).toHaveBeenCalled();
      // Auto-generated story should use session.task as text
      const callArg = huReviewerRunMock.mock.calls[0][0];
      expect(callArg.stories.some(s => s.text === session.task || s.id === "HU-AUTO-001")).toBe(true);
    });

    it("falls back to auto-generation when pgStories is empty array", async () => {
      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "HU-AUTO-001",
            scores: { D1_jtbd_context: 6, D2_user_specificity: 5, D3_behavior_change: 6, D4_control_zone: 7, D5_time_constraints: 6, D6_survivable_experiment: 5 },
            total: 35,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Fallback",
            certified_hu: { id: "HU-AUTO-001", text: session.task }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0 }
        },
        summary: "HU Review complete: 1 certified",
        usage: { tokens_in: 200, tokens_out: 150 }
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null, askQuestion: null, pgStories: []
      });

      expect(result.stageResult.ok).toBe(true);
      expect(huReviewerRunMock).toHaveBeenCalled();
    });
  });

  describe("PG card acceptance criteria included in HU", () => {
    it("includes structured acceptance criteria (Given/When/Then) in story text", () => {
      const pgCard = {
        cardId: "KJC-TSK-0188",
        descriptionStructured: [
          { role: "a developer", goal: "integrate PG with hu-reviewer", benefit: "better story quality" }
        ],
        acceptanceCriteriaStructured: [
          { given: "a PG card with structured data", when: "the pipeline runs", then: "hu-reviewer receives PG stories" },
          { given: "a PG card without structured data", when: "the pipeline runs", then: "hu-reviewer falls back to task description" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Given a PG card with structured data");
      expect(stories[0].text).toContain("When the pipeline runs");
      expect(stories[0].text).toContain("Then hu-reviewer receives PG stories");
      expect(stories[0].text).toContain("Given a PG card without structured data");
      expect(stories[0].text).toContain("Then hu-reviewer falls back to task description");
    });

    it("includes plain string acceptanceCriteria when no structured AC is available", () => {
      const pgCard = {
        cardId: "KJC-TSK-0300",
        descriptionStructured: [
          { role: "a QA", goal: "validate the feature", benefit: "bugs are caught early" }
        ],
        acceptanceCriteria: "All unit tests pass.\nNo regressions in existing functionality."
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("All unit tests pass.");
      expect(stories[0].text).toContain("No regressions in existing functionality.");
    });

    it("omits acceptance criteria section when neither structured nor plain AC exist", () => {
      const pgCard = {
        cardId: "KJC-TSK-0301",
        descriptionStructured: [
          { role: "a dev", goal: "do something", benefit: "it works" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).not.toContain("Acceptance Criteria:");
    });
  });
});
