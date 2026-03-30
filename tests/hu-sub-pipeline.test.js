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
  topologicalSort: vi.fn((stories) => {
    // Simple implementation: dependencies first via Kahn's algorithm
    const ids = new Set(stories.map(s => s.id));
    const inDegree = new Map();
    const adj = new Map();
    for (const s of stories) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }
    for (const s of stories) {
      for (const dep of (s.blocked_by || [])) {
        if (ids.has(dep)) {
          adj.get(dep).push(s.id);
          inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
        }
      }
    }
    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }
    const sorted = [];
    while (queue.length > 0) {
      const id = queue.shift();
      sorted.push(id);
      for (const dependent of adj.get(id)) {
        inDegree.set(dependent, inDegree.get(dependent) - 1);
        if (inDegree.get(dependent) === 0) queue.push(dependent);
      }
    }
    return sorted;
  })
}));

const { needsSubPipeline, runHuSubPipeline, blockDependents } = await import("../src/orchestrator/hu-sub-pipeline.js");
const { topologicalSort } = await import("../src/hu/graph.js");

describe("hu-sub-pipeline", () => {
  const logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };

  let emitter;
  let eventBase;
  let events;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    eventBase = { sessionId: "s_test_sub", iteration: 0, stage: null, startedAt: Date.now() };
    events = [];
    emitter.on("progress", (evt) => events.push(evt));
  });

  // --- needsSubPipeline ---

  describe("needsSubPipeline", () => {
    it("returns false for null/undefined huReviewerResult", () => {
      expect(needsSubPipeline(null)).toBe(false);
      expect(needsSubPipeline(undefined)).toBe(false);
    });

    it("returns false when ok is false", () => {
      expect(needsSubPipeline({ ok: false, stories: [] })).toBe(false);
    });

    it("returns false for single certified story (no sub-pipeline needed)", () => {
      const result = {
        ok: true,
        certified: 1,
        total: 1,
        stories: [{ id: "HU-001", status: "certified" }]
      };
      expect(needsSubPipeline(result)).toBe(false);
    });

    it("returns true for multiple certified stories", () => {
      const result = {
        ok: true,
        certified: 3,
        total: 3,
        stories: [
          { id: "HU-001", status: "certified" },
          { id: "HU-002", status: "certified" },
          { id: "HU-003", status: "certified" }
        ]
      };
      expect(needsSubPipeline(result)).toBe(true);
    });

    it("returns false when only one story is certified even if total > 1", () => {
      const result = {
        ok: true,
        certified: 1,
        total: 3,
        stories: [
          { id: "HU-001", status: "certified" },
          { id: "HU-002", status: "needs_context" },
          { id: "HU-003", status: "pending" }
        ]
      };
      expect(needsSubPipeline(result)).toBe(false);
    });
  });

  // --- blockDependents ---

  describe("blockDependents", () => {
    it("blocks direct dependents of a failed story", () => {
      const batch = {
        stories: [
          { id: "HU-001", status: "done", blocked_by: [] },
          { id: "HU-002", status: "certified", blocked_by: ["HU-001"] },
          { id: "HU-003", status: "certified", blocked_by: ["HU-001"] }
        ]
      };
      const blocked = blockDependents(batch, "HU-001");
      expect(blocked).toEqual(expect.arrayContaining(["HU-002", "HU-003"]));
      expect(batch.stories[1].status).toBe("blocked");
      expect(batch.stories[2].status).toBe("blocked");
    });

    it("blocks transitive dependents", () => {
      const batch = {
        stories: [
          { id: "HU-001", status: "failed", blocked_by: [] },
          { id: "HU-002", status: "certified", blocked_by: ["HU-001"] },
          { id: "HU-003", status: "certified", blocked_by: ["HU-002"] }
        ]
      };
      const blocked = blockDependents(batch, "HU-001");
      expect(blocked).toContain("HU-002");
      expect(blocked).toContain("HU-003");
    });

    it("does not block stories with no dependency on failed story", () => {
      const batch = {
        stories: [
          { id: "HU-001", status: "failed", blocked_by: [] },
          { id: "HU-002", status: "certified", blocked_by: [] },
          { id: "HU-003", status: "certified", blocked_by: ["HU-001"] }
        ]
      };
      const blocked = blockDependents(batch, "HU-001");
      expect(blocked).toEqual(["HU-003"]);
      expect(batch.stories[1].status).toBe("certified");
    });
  });

  // --- runHuSubPipeline ---

  describe("runHuSubPipeline — single HU runs pipeline as before", () => {
    it("single HU detected by needsSubPipeline returns false — no sub-pipeline", () => {
      const result = {
        ok: true,
        certified: 1,
        total: 1,
        stories: [{ id: "HU-001", status: "certified", certified: { text: "do thing" }, original: { text: "do thing" }, blocked_by: [] }]
      };
      expect(needsSubPipeline(result)).toBe(false);
    });
  });

  describe("runHuSubPipeline — multiple HUs run in topological order", () => {
    it("runs 3 HUs in dependency order and all succeed", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Setup base" }, original: { text: "Setup base" }, blocked_by: [] },
        { id: "HU-002", status: "certified", certified: { text: "Build feature A" }, original: { text: "Build feature A" }, blocked_by: ["HU-001"] },
        { id: "HU-003", status: "certified", certified: { text: "Build feature B" }, original: { text: "Build feature B" }, blocked_by: ["HU-001"] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runOrder = [];
      const runIterationFn = vi.fn(async (task) => {
        runOrder.push(task);
        return { approved: true };
      });

      const huReviewerResult = {
        ok: true,
        certified: 3,
        total: 3,
        stories,
        batchSessionId: "hu-s_test_sub"
      };

      const result = await runHuSubPipeline({
        huReviewerResult,
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      expect(result.approved).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.blockedIds).toHaveLength(0);

      // Verify topological order: HU-001 first, then HU-002 and HU-003
      expect(runOrder[0]).toBe("Setup base");
      expect(runIterationFn).toHaveBeenCalledTimes(3);

      // Verify topologicalSort was called
      expect(topologicalSort).toHaveBeenCalled();
    });
  });

  describe("runHuSubPipeline — failed HU blocks dependents", () => {
    it("when HU-001 fails, HU-002 (which depends on it) is blocked", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Base setup" }, original: { text: "Base setup" }, blocked_by: [] },
        { id: "HU-002", status: "certified", certified: { text: "Feature" }, original: { text: "Feature" }, blocked_by: ["HU-001"] },
        { id: "HU-003", status: "certified", certified: { text: "Independent" }, original: { text: "Independent" }, blocked_by: [] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      let callCount = 0;
      const runIterationFn = vi.fn(async (task) => {
        callCount++;
        if (task === "Base setup") return { approved: false, reason: "test_failure" };
        return { approved: true };
      });

      const result = await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 3, total: 3, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      expect(result.approved).toBe(false);
      expect(result.blockedIds).toContain("HU-002");

      // HU-001 failed, HU-002 blocked (not run), HU-003 independent (should run)
      // runIterationFn called for HU-001 and HU-003, but NOT HU-002
      expect(runIterationFn).toHaveBeenCalledTimes(2);

      // Check results
      const hu001Result = result.results.find(r => r.huId === "HU-001");
      const hu003Result = result.results.find(r => r.huId === "HU-003");
      expect(hu001Result.approved).toBe(false);
      expect(hu003Result.approved).toBe(true);
    });

    it("when HU throws an error, dependents are blocked", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Base" }, original: { text: "Base" }, blocked_by: [] },
        { id: "HU-002", status: "certified", certified: { text: "Dep" }, original: { text: "Dep" }, blocked_by: ["HU-001"] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async (task) => {
        if (task === "Base") throw new Error("Coder crashed");
        return { approved: true };
      });

      const result = await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      expect(result.approved).toBe(false);
      expect(result.blockedIds).toContain("HU-002");
      expect(result.results[0].error).toBe("Coder crashed");
    });
  });

  describe("runHuSubPipeline — emits hu:start and hu:end events", () => {
    it("emits hu:start and hu:end for each HU processed", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Task A" }, original: { text: "Task A" }, blocked_by: [] },
        { id: "HU-002", status: "certified", certified: { text: "Task B" }, original: { text: "Task B" }, blocked_by: [] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      const huStartEvents = events.filter(e => e.type === "hu:start");
      const huEndEvents = events.filter(e => e.type === "hu:end");

      expect(huStartEvents).toHaveLength(2);
      expect(huEndEvents).toHaveLength(2);

      expect(huStartEvents[0].detail.huId).toBe("HU-001");
      expect(huStartEvents[1].detail.huId).toBe("HU-002");

      expect(huEndEvents[0].detail.huId).toBe("HU-001");
      expect(huEndEvents[0].detail.approved).toBe(true);
      expect(huEndEvents[1].detail.huId).toBe("HU-002");
      expect(huEndEvents[1].detail.approved).toBe(true);
    });

    it("emits hu:end with fail status when HU fails", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Fail task" }, original: { text: "Fail task" }, blocked_by: [] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: false, reason: "reviewer_rejected" }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      const huEndEvents = events.filter(e => e.type === "hu:end");
      expect(huEndEvents).toHaveLength(1);
      expect(huEndEvents[0].status).toBe("fail");
      expect(huEndEvents[0].detail.approved).toBe(false);
    });
  });

  describe("runHuSubPipeline — HU status transitions are saved to store", () => {
    it("transitions certified → coding → reviewing → done and saves batch after each status change", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Task" }, original: { text: "Task" }, blocked_by: [] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: true }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      // updateStoryStatus called three times: coding → reviewing → done
      const statusCalls = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001");
      expect(statusCalls).toHaveLength(3);
      expect(statusCalls[0][2]).toBe("coding");
      expect(statusCalls[1][2]).toBe("reviewing");
      expect(statusCalls[2][2]).toBe("done");

      // saveHuBatch called after each status change (coding + reviewing + done) + once after group completes
      expect(saveHuBatchMock).toHaveBeenCalledTimes(4);
    });

    it("transitions certified → coding → reviewing → failed when iteration fails", async () => {
      const stories = [
        { id: "HU-001", status: "certified", certified: { text: "Fail" }, original: { text: "Fail" }, blocked_by: [] }
      ];

      const batch = { session_id: "hu-s_test_sub", stories: [...stories] };
      loadHuBatchMock.mockResolvedValue(batch);

      const runIterationFn = vi.fn(async () => ({ approved: false }));

      await runHuSubPipeline({
        huReviewerResult: {
          ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_test_sub"
        },
        runIterationFn,
        emitter,
        eventBase,
        logger
      });

      const statusCalls = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001");
      expect(statusCalls).toHaveLength(3);
      expect(statusCalls[0][2]).toBe("coding");
      expect(statusCalls[1][2]).toBe("reviewing");
      expect(statusCalls[2][2]).toBe("failed");
    });
  });
});
