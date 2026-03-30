import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const saveHuBatchMock = vi.fn(async () => {});
const loadHuBatchMock = vi.fn();
const updateStoryStatusMock = vi.fn((batch, storyId, status) => {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.status = status;
  story.statusChangedAt = new Date().toISOString();
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

vi.mock("../src/hu/parallel-executor.js", () => ({
  findParallelGroups: vi.fn((stories, orderedIds) => orderedIds.map(id => [id])),
  createWorktree: vi.fn(async () => "/tmp/wt"),
  mergeWorktree: vi.fn(async () => {}),
  removeWorktree: vi.fn(async () => {})
}));

vi.mock("../src/hu/lazy-planner.js", () => ({
  refineHuWithContext: vi.fn(async (story) => story)
}));

const { runHuSubPipeline } = await import("../src/orchestrator/hu-sub-pipeline.js");

describe("hu-board-sync — HU status changes for real-time board sync", () => {
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
    eventBase = { sessionId: "s_board_sync", iteration: 0, stage: null, startedAt: Date.now() };
    events = [];
    emitter.on("progress", (evt) => events.push(evt));
  });

  function makeStories(ids) {
    return ids.map(id => ({
      id,
      status: "certified",
      certified: { text: `Task ${id}` },
      original: { text: `Task ${id}` },
      blocked_by: []
    }));
  }

  function makeHuReviewerResult(stories, batchSessionId = "hu-s_board") {
    return {
      ok: true,
      certified: stories.length,
      total: stories.length,
      stories,
      batchSessionId
    };
  }

  // --- Status transitions ---

  it("HU status changes to 'coding' when coder starts", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const firstStatusCall = updateStoryStatusMock.mock.calls.find(c => c[1] === "HU-001");
    expect(firstStatusCall[2]).toBe("coding");
  });

  it("HU status changes to 'reviewing' after coder, before reviewer", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusCalls = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001");
    expect(statusCalls[1][2]).toBe("reviewing");
  });

  it("HU status changes to 'done' after approval", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusCalls = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001");
    const lastCall = statusCalls[statusCalls.length - 1];
    expect(lastCall[2]).toBe("done");
  });

  it("HU status changes to 'failed' on error", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => { throw new Error("coder crashed"); });

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusCalls = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001");
    const lastCall = statusCalls[statusCalls.length - 1];
    expect(lastCall[2]).toBe("failed");
  });

  // --- Batch save for chokidar sync ---

  it("each status change saves the batch (for chokidar sync)", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    // coding + reviewing + done = 3 saves from status changes
    const statusChangeCount = updateStoryStatusMock.mock.calls.filter(c => c[1] === "HU-001").length;
    expect(statusChangeCount).toBe(3);
    // saveHuBatch called at least once per status change
    expect(saveHuBatchMock.mock.calls.length).toBeGreaterThanOrEqual(statusChangeCount);
  });

  // --- hu:status-change event ---

  it("hu:status-change event emitted with correct data for each transition", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusChangeEvents = events.filter(e => e.type === "hu:status-change");
    expect(statusChangeEvents.length).toBe(3);

    // Verify coding event
    expect(statusChangeEvents[0].detail.huId).toBe("HU-001");
    expect(statusChangeEvents[0].detail.status).toBe("coding");

    // Verify reviewing event
    expect(statusChangeEvents[1].detail.huId).toBe("HU-001");
    expect(statusChangeEvents[1].detail.status).toBe("reviewing");

    // Verify done event
    expect(statusChangeEvents[2].detail.huId).toBe("HU-001");
    expect(statusChangeEvents[2].detail.status).toBe("done");
  });

  it("hu:status-change event includes timestamp", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusChangeEvents = events.filter(e => e.type === "hu:status-change");
    for (const evt of statusChangeEvents) {
      expect(evt.detail.timestamp).toBeDefined();
      // Verify it's a valid ISO date string
      expect(new Date(evt.detail.timestamp).toISOString()).toBe(evt.detail.timestamp);
    }
  });

  it("status includes timestamp via statusChangedAt on story", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    // The mock sets statusChangedAt; verify the real updateStoryStatus was called
    // and that the story has statusChangedAt set
    const lastStoryState = batch.stories.find(s => s.id === "HU-001");
    expect(lastStoryState.statusChangedAt).toBeDefined();
    expect(new Date(lastStoryState.statusChangedAt).toISOString()).toBe(lastStoryState.statusChangedAt);
  });

  it("failed HU emits hu:status-change with 'failed' status", async () => {
    const stories = makeStories(["HU-001"]);
    const batch = { session_id: "hu-s_board", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: false, reason: "review_rejected" }));

    await runHuSubPipeline({
      huReviewerResult: makeHuReviewerResult(stories),
      runIterationFn, emitter, eventBase, logger
    });

    const statusChangeEvents = events.filter(e => e.type === "hu:status-change");
    // coding → reviewing → failed
    expect(statusChangeEvents.length).toBe(3);
    expect(statusChangeEvents[0].detail.status).toBe("coding");
    expect(statusChangeEvents[1].detail.status).toBe("reviewing");
    expect(statusChangeEvents[2].detail.status).toBe("failed");
  });
});
