import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const saveHuBatchMock = vi.fn(async () => {});
const loadHuBatchMock = vi.fn();
const updateStoryStatusMock = vi.fn((batch, storyId, status) => {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.status = status;
  return story;
});

vi.mock("../src/hu/store.js", () => ({
  HU_STATUS: Object.freeze({
    PENDING: "pending",
    CODING: "coding",
    REVIEWING: "reviewing",
    DONE: "done",
    FAILED: "failed",
    BLOCKED: "blocked",
    CERTIFIED: "certified",
    NEEDS_CONTEXT: "needs_context"
  }),
  loadHuBatch: (...args) => loadHuBatchMock(...args),
  saveHuBatch: (...args) => saveHuBatchMock(...args),
  updateStoryStatus: (...args) => updateStoryStatusMock(...args)
}));

vi.mock("../src/hu/graph.js", () => ({
  topologicalSort: vi.fn((stories) => stories.map(s => s.id))
}));

const refineHuWithContextMock = vi.fn();

vi.mock("../src/hu/lazy-planner.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    refineHuWithContext: (...args) => refineHuWithContextMock(...args),
  };
});

const { runHuSubPipeline } = await import("../src/orchestrator/hu-sub-pipeline.js");
const { buildRefinementPrompt } = await import("../src/hu/lazy-planner.js");

describe("lazy-hu-planning", () => {
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };

  let emitter;
  let eventBase;
  let events;

  const config = {
    roles: {
      hu_reviewer: { provider: "claude" },
      coder: { provider: "claude" }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    eventBase = { sessionId: "s_lazy_test", iteration: 0, stage: null, startedAt: Date.now() };
    events = [];
    emitter.on("progress", (evt) => events.push(evt));
  });

  describe("first HU has full AC, second has needsRefinement: true", () => {
    it("first HU is not refined, second HU triggers refinement", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "Setup base\n\nAcceptance Criteria:\n- Base is set up" },
          original: { text: "Setup base" },
          blocked_by: [],
          needsRefinement: false
        },
        {
          id: "HU-002", status: "certified",
          certified: { text: "Build feature" },
          original: { text: "Build feature" },
          blocked_by: [],
          needsRefinement: true
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      refineHuWithContextMock.mockResolvedValue({
        ...stories[1],
        certified: { text: "Build feature with refined AC", title: "Build feature", acceptanceCriteria: ["Feature works"] },
        needsRefinement: false
      });

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger,
        config
      });

      // refineHuWithContext should only be called for HU-002 (needsRefinement: true)
      expect(refineHuWithContextMock).toHaveBeenCalledTimes(1);
      expect(refineHuWithContextMock.mock.calls[0][0].id).toBe("HU-002");
    });
  });

  describe("refineHuWithContext includes completed HU results in prompt", () => {
    it("passes completed HU data to refinement function", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "Setup base", title: "Setup" },
          original: { text: "Setup base" },
          blocked_by: [],
          needsRefinement: false
        },
        {
          id: "HU-002", status: "certified",
          certified: { text: "Build feature" },
          original: { text: "Build feature" },
          blocked_by: [],
          needsRefinement: true
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      refineHuWithContextMock.mockImplementation(async (hu) => ({
        ...hu,
        certified: { text: "Refined feature", acceptanceCriteria: ["Works"] },
        needsRefinement: false
      }));

      const runIterationFn = vi.fn(async () => ({ approved: true, summary: "Completed successfully" }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger,
        config
      });

      // The second call to refineHuWithContext should include completed HU-001 in completedHus
      const completedHusArg = refineHuWithContextMock.mock.calls[0][1];
      expect(completedHusArg).toHaveLength(1);
      expect(completedHusArg[0].id).toBe("HU-001");
    });
  });

  describe("buildRefinementPrompt contains previous HU summaries", () => {
    it("includes completed HU details in the prompt", () => {
      const hu = {
        id: "HU-002",
        original: { text: "Build feature X" },
        certified: { text: "Build feature X" }
      };

      const completedHus = [
        {
          id: "HU-001",
          certified: { text: "Setup base config", title: "Setup Base" },
          original: { text: "Setup base" },
          resultSummary: "Base configuration completed with all defaults"
        }
      ];

      const prompt = buildRefinementPrompt(hu, completedHus);

      expect(prompt).toContain("HU-001");
      expect(prompt).toContain("Setup Base");
      expect(prompt).toContain("Base configuration completed with all defaults");
      expect(prompt).toContain("HU-002");
      expect(prompt).toContain("Build feature X");
      expect(prompt).toContain("Previously Completed HUs");
    });

    it("generates prompt without completed HUs section when none provided", () => {
      const hu = {
        id: "HU-001",
        original: { text: "First story" },
        certified: null
      };

      const prompt = buildRefinementPrompt(hu, []);

      expect(prompt).toContain("HU-001");
      expect(prompt).toContain("First story");
      expect(prompt).not.toContain("Previously Completed HUs");
    });
  });

  describe("single HU task: no refinement needed", () => {
    it("does not call refineHuWithContext for a single HU without needsRefinement", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "Single task" },
          original: { text: "Single task" },
          blocked_by: [],
          needsRefinement: false
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger,
        config
      });

      expect(refineHuWithContextMock).not.toHaveBeenCalled();
      expect(runIterationFn).toHaveBeenCalledTimes(1);
    });

    it("does not call refineHuWithContext when config is null", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "Task" },
          original: { text: "Task" },
          blocked_by: [],
          needsRefinement: true
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
        // config omitted — defaults to null
      });

      expect(refineHuWithContextMock).not.toHaveBeenCalled();
    });
  });

  describe("refinement updates the HU in the batch", () => {
    it("after refinement, the coder receives the refined task description", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "Setup base" },
          original: { text: "Setup base" },
          blocked_by: [],
          needsRefinement: false
        },
        {
          id: "HU-002", status: "certified",
          certified: { text: "Skeleton description" },
          original: { text: "Build feature" },
          blocked_by: [],
          needsRefinement: true
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      refineHuWithContextMock.mockImplementation(async (hu) => ({
        ...hu,
        certified: { text: "Fully refined feature description with detailed AC", title: "Feature" },
        needsRefinement: false
      }));

      const tasksReceived = [];
      const runIterationFn = vi.fn(async (task) => {
        tasksReceived.push(task);
        return { approved: true };
      });

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger,
        config
      });

      // First HU gets original text, second gets refined text
      expect(tasksReceived[0]).toBe("Setup base");
      expect(tasksReceived[1]).toBe("Fully refined feature description with detailed AC");

      // Batch should have been saved after refinement (extra save)
      // Saves: HU-001 coding, HU-001 done, HU-002 refinement, HU-002 coding, HU-002 done = 5
      expect(saveHuBatchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it("emits hu:refine-start and hu:refine-end events", async () => {
      const stories = [
        {
          id: "HU-001", status: "certified",
          certified: { text: "First" },
          original: { text: "First" },
          blocked_by: [],
          needsRefinement: false
        },
        {
          id: "HU-002", status: "certified",
          certified: { text: "Second" },
          original: { text: "Second" },
          blocked_by: [],
          needsRefinement: true
        }
      ];

      const batch = { session_id: "hu-s_lazy_test", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      refineHuWithContextMock.mockImplementation(async (hu) => ({
        ...hu,
        certified: { text: "Refined" },
        needsRefinement: false
      }));

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_lazy_test"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger,
        config
      });

      const refineStartEvents = events.filter(e => e.type === "hu:refine-start");
      const refineEndEvents = events.filter(e => e.type === "hu:refine-end");

      expect(refineStartEvents).toHaveLength(1);
      expect(refineStartEvents[0].detail.huId).toBe("HU-002");
      expect(refineEndEvents).toHaveLength(1);
      expect(refineEndEvents[0].detail.huId).toBe("HU-002");
    });
  });
});
