import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const huReviewerRunMock = vi.fn();
const agentRunTaskMock = vi.fn();

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() { return { ok: true, result: { level: "medium", roles: [] } }; }
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
      original: { text: s.text || s.original?.text || "" },
      status: "pending",
      blocked_by: s.blocked_by || [],
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
    runTask: (...args) => agentRunTaskMock(...args)
  }))
}));

const { runHuReviewerStage } = await import("../src/orchestrator/pre-loop-stages.js");
const { buildDecompositionPrompt, parseDecompositionOutput } = await import("../src/prompts/hu-reviewer.js");
const { topologicalSort } = await import("../src/hu/graph.js");

describe("hu-decomposition", () => {
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
        coder: { provider: "codex", model: null },
        hu_reviewer: { provider: "claude", model: null }
      },
      model_selection: { enabled: false }
    };
    session = {
      id: "s_decomp_test",
      task: "Build a new user dashboard with authentication, role-based access control, and analytics widgets",
      checkpoints: []
    };
    eventBase = { sessionId: "s_decomp_test", iteration: 0, stage: null, startedAt: Date.now() };
  });

  describe("buildDecompositionPrompt", () => {
    it("includes the task in the prompt", () => {
      const prompt = buildDecompositionPrompt("Build a dashboard");
      expect(prompt).toContain("Build a dashboard");
      expect(prompt).toContain("Task Decomposition");
      expect(prompt).toContain("2-5");
    });

    it("requests JSON output with the correct schema fields", () => {
      const prompt = buildDecompositionPrompt("Test task");
      expect(prompt).toContain("stories");
      expect(prompt).toContain("role");
      expect(prompt).toContain("goal");
      expect(prompt).toContain("benefit");
      expect(prompt).toContain("acceptanceCriteria");
      expect(prompt).toContain("dependsOn");
    });
  });

  describe("parseDecompositionOutput", () => {
    it("parses valid decomposition JSON", () => {
      const raw = JSON.stringify({
        stories: [
          {
            id: "HU-DECOMP-001",
            title: "User authentication",
            role: "developer",
            goal: "implement login flow",
            benefit: "users can access the system",
            acceptanceCriteria: ["Login form renders", "JWT token stored"],
            dependsOn: []
          },
          {
            id: "HU-DECOMP-002",
            title: "Role-based access",
            role: "admin",
            goal: "restrict pages by role",
            benefit: "security is enforced",
            acceptanceCriteria: ["Admin page blocked for regular users"],
            dependsOn: ["HU-DECOMP-001"]
          }
        ]
      });

      const result = parseDecompositionOutput(raw);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("HU-DECOMP-001");
      expect(result[0].title).toBe("User authentication");
      expect(result[0].acceptanceCriteria).toHaveLength(2);
      expect(result[1].dependsOn).toEqual(["HU-DECOMP-001"]);
    });

    it("returns null for invalid output", () => {
      expect(parseDecompositionOutput("not json")).toBeNull();
      expect(parseDecompositionOutput("{}")).toBeNull();
      expect(parseDecompositionOutput(JSON.stringify({ stories: [] }))).toBeNull();
    });

    it("filters out stories missing required fields", () => {
      const raw = JSON.stringify({
        stories: [
          { id: "HU-DECOMP-001", title: "Valid story", role: "dev", goal: "do thing", benefit: "good", acceptanceCriteria: ["test"], dependsOn: [] },
          { title: "Missing id" },
          { id: "HU-DECOMP-003" }
        ]
      });

      const result = parseDecompositionOutput(raw);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("HU-DECOMP-001");
    });
  });

  describe("complex task is decomposed into multiple HUs", () => {
    it("decomposes a complex task and certifies each HU", async () => {
      const decomposedStories = {
        stories: [
          {
            id: "HU-DECOMP-001",
            title: "User authentication",
            role: "developer",
            goal: "implement login flow",
            benefit: "users can access the system securely",
            acceptanceCriteria: ["Login form renders correctly", "JWT token is stored on success"],
            dependsOn: []
          },
          {
            id: "HU-DECOMP-002",
            title: "Role-based access control",
            role: "admin",
            goal: "restrict pages by user role",
            benefit: "only authorized users access sensitive pages",
            acceptanceCriteria: ["Admin pages blocked for regular users", "Unauthorized access returns 403"],
            dependsOn: ["HU-DECOMP-001"]
          },
          {
            id: "HU-DECOMP-003",
            title: "Analytics widgets",
            role: "product owner",
            goal: "view usage analytics on dashboard",
            benefit: "data-driven decisions can be made",
            acceptanceCriteria: ["Dashboard shows user activity chart", "Data refreshes every 5 minutes"],
            dependsOn: ["HU-DECOMP-001"]
          }
        ]
      };

      // Mock the decomposition agent call
      agentRunTaskMock.mockResolvedValue({
        ok: true,
        output: JSON.stringify(decomposedStories),
        usage: { tokens_in: 300, tokens_out: 400 }
      });

      // Mock the hu-reviewer certification for each decomposed story
      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [
            {
              story_id: "HU-DECOMP-001",
              scores: { D1_jtbd_context: 8, D2_user_specificity: 7, D3_behavior_change: 8, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
              total: 44,
              antipatterns_detected: [],
              verdict: "certified",
              evaluation_notes: "Well-defined story",
              certified_hu: { id: "HU-DECOMP-001", text: "authentication story" }
            },
            {
              story_id: "HU-DECOMP-002",
              scores: { D1_jtbd_context: 7, D2_user_specificity: 8, D3_behavior_change: 7, D4_control_zone: 8, D5_time_constraints: 6, D6_survivable_experiment: 7 },
              total: 43,
              antipatterns_detected: [],
              verdict: "certified",
              evaluation_notes: "Good RBAC story",
              certified_hu: { id: "HU-DECOMP-002", text: "rbac story" }
            },
            {
              story_id: "HU-DECOMP-003",
              scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
              total: 42,
              antipatterns_detected: [],
              verdict: "certified",
              evaluation_notes: "Good analytics story",
              certified_hu: { id: "HU-DECOMP-003", text: "analytics story" }
            }
          ],
          batch_summary: { total: 3, certified: 3, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" }
        },
        summary: "HU Review complete: 3 certified",
        usage: { tokens_in: 500, tokens_out: 400 }
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null,
        askQuestion: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.total).toBe(3);
      expect(result.stageResult.certified).toBe(3);

      // Verify the decomposition agent was called
      expect(agentRunTaskMock).toHaveBeenCalled();
      const decompCall = agentRunTaskMock.mock.calls[0][0];
      expect(decompCall.prompt).toContain("Task Decomposition");

      // Verify hu-reviewer was called to certify the stories
      expect(huReviewerRunMock).toHaveBeenCalled();
    });
  });

  describe("each decomposed HU has required fields", () => {
    it("parseDecompositionOutput enforces id, title, role, goal, benefit, acceptanceCriteria, dependsOn", () => {
      const raw = JSON.stringify({
        stories: [
          {
            id: "HU-DECOMP-001",
            title: "Complete story",
            role: "user",
            goal: "do something",
            benefit: "value delivered",
            acceptanceCriteria: ["criterion 1"],
            dependsOn: []
          }
        ]
      });

      const result = parseDecompositionOutput(raw);
      expect(result).toHaveLength(1);
      const hu = result[0];
      expect(hu).toHaveProperty("id");
      expect(hu).toHaveProperty("title");
      expect(hu).toHaveProperty("role");
      expect(hu).toHaveProperty("goal");
      expect(hu).toHaveProperty("benefit");
      expect(hu).toHaveProperty("acceptanceCriteria");
      expect(hu).toHaveProperty("dependsOn");
      expect(Array.isArray(hu.acceptanceCriteria)).toBe(true);
      expect(Array.isArray(hu.dependsOn)).toBe(true);
    });
  });

  describe("dependencies create a graph with topological ordering", () => {
    it("topologicalSort is called with stories that have blocked_by from dependsOn", async () => {
      const decomposedStories = {
        stories: [
          { id: "HU-DECOMP-001", title: "Base setup", role: "dev", goal: "setup", benefit: "foundation", acceptanceCriteria: ["Done"], dependsOn: [] },
          { id: "HU-DECOMP-002", title: "Feature A", role: "dev", goal: "build A", benefit: "value", acceptanceCriteria: ["Done"], dependsOn: ["HU-DECOMP-001"] }
        ]
      };

      agentRunTaskMock.mockResolvedValue({
        ok: true,
        output: JSON.stringify(decomposedStories),
        usage: {}
      });

      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [
            { story_id: "HU-DECOMP-001", scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 }, total: 42, antipatterns_detected: [], verdict: "certified", evaluation_notes: "ok", certified_hu: { id: "HU-DECOMP-001", text: "base" } },
            { story_id: "HU-DECOMP-002", scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 }, total: 42, antipatterns_detected: [], verdict: "certified", evaluation_notes: "ok", certified_hu: { id: "HU-DECOMP-002", text: "feature" } }
          ],
          batch_summary: { total: 2, certified: 2, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" }
        },
        usage: {}
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null,
        askQuestion: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.total).toBe(2);
      // Verify topologicalSort was called with certified stories
      expect(topologicalSort).toHaveBeenCalled();
    });
  });

  describe("simple auto-story still works as before", () => {
    it("falls back to single HU-AUTO-001 when decomposition returns < 2 stories", async () => {
      // Decomposition returns only 1 story (not enough to decompose)
      agentRunTaskMock.mockResolvedValue({
        ok: true,
        output: JSON.stringify({
          stories: [
            { id: "HU-DECOMP-001", title: "Simple fix", role: "dev", goal: "fix typo", benefit: "correctness", acceptanceCriteria: ["Typo fixed"], dependsOn: [] }
          ]
        }),
        usage: {}
      });

      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "HU-AUTO-001",
            scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
            total: 42,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Simple task",
            certified_hu: { id: "HU-AUTO-001", text: session.task }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" }
        },
        usage: {}
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null,
        askQuestion: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.total).toBe(1);
      // The HU reviewer should have been called with the auto-generated single story
      expect(huReviewerRunMock).toHaveBeenCalled();
      const reviewCall = huReviewerRunMock.mock.calls[0][0];
      expect(reviewCall.stories).toHaveLength(1);
      expect(reviewCall.stories[0].id).toBe("HU-AUTO-001");
    });

    it("falls back to single HU-AUTO-001 when decomposition agent fails", async () => {
      agentRunTaskMock.mockResolvedValue({
        ok: false,
        error: "Agent unavailable",
        output: "",
        usage: {}
      });

      huReviewerRunMock.mockResolvedValue({
        ok: true,
        result: {
          evaluations: [{
            story_id: "HU-AUTO-001",
            scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
            total: 42,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Fallback ok",
            certified_hu: { id: "HU-AUTO-001", text: session.task }
          }],
          batch_summary: { total: 1, certified: 1, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" }
        },
        usage: {}
      });

      const result = await runHuReviewerStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        huFile: null,
        askQuestion: null
      });

      expect(result.stageResult.ok).toBe(true);
      expect(result.stageResult.total).toBe(1);
      expect(huReviewerRunMock).toHaveBeenCalled();
      const reviewCall = huReviewerRunMock.mock.calls[0][0];
      expect(reviewCall.stories[0].id).toBe("HU-AUTO-001");
    });
  });
});
