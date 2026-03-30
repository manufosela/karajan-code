import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks ---

const execFileAsyncMock = vi.fn(async () => ({ stdout: "", stderr: "" }));

vi.mock("node:child_process", () => ({
  execFile: (...args) => {
    const cb = args[args.length - 1];
    execFileAsyncMock(...args.slice(0, -1))
      .then(res => cb(null, res.stdout, res.stderr))
      .catch(err => cb(err));
  }
}));

vi.mock("node:util", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    promisify: () => execFileAsyncMock
  };
});

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

vi.mock("../src/hu/lazy-planner.js", () => ({
  refineHuWithContext: vi.fn(async (story) => story)
}));

const { findParallelGroups, createWorktree, removeWorktree, mergeWorktree } = await import("../src/hu/parallel-executor.js");
const { runHuSubPipeline } = await import("../src/orchestrator/hu-sub-pipeline.js");

describe("parallel-executor — findParallelGroups", () => {
  it("3 independent HUs → 1 batch of 3", () => {
    const stories = [
      { id: "HU-001", blocked_by: [] },
      { id: "HU-002", blocked_by: [] },
      { id: "HU-003", blocked_by: [] }
    ];
    const order = ["HU-001", "HU-002", "HU-003"];
    const groups = findParallelGroups(stories, order);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.arrayContaining(["HU-001", "HU-002", "HU-003"]));
    expect(groups[0]).toHaveLength(3);
  });

  it("linear chain A→B→C → 3 batches of 1", () => {
    const stories = [
      { id: "A", blocked_by: [] },
      { id: "B", blocked_by: ["A"] },
      { id: "C", blocked_by: ["B"] }
    ];
    const order = ["A", "B", "C"];
    const groups = findParallelGroups(stories, order);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual(["A"]);
    expect(groups[1]).toEqual(["B"]);
    expect(groups[2]).toEqual(["C"]);
  });

  it("diamond: A→B, A→C, B→D, C→D → [[A], [B,C], [D]]", () => {
    const stories = [
      { id: "A", blocked_by: [] },
      { id: "B", blocked_by: ["A"] },
      { id: "C", blocked_by: ["A"] },
      { id: "D", blocked_by: ["B", "C"] }
    ];
    const order = ["A", "B", "C", "D"];
    const groups = findParallelGroups(stories, order);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual(["A"]);
    expect(groups[1]).toEqual(expect.arrayContaining(["B", "C"]));
    expect(groups[1]).toHaveLength(2);
    expect(groups[2]).toEqual(["D"]);
  });

  it("single HU → 1 batch of 1", () => {
    const stories = [{ id: "HU-001", blocked_by: [] }];
    const order = ["HU-001"];
    const groups = findParallelGroups(stories, order);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(["HU-001"]);
  });

  it("empty input → empty output", () => {
    const groups = findParallelGroups([], []);
    expect(groups).toEqual([]);
  });
});

describe("parallel-executor — createWorktree / removeWorktree (mocked git)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createWorktree calls git worktree add with correct args", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });
    const result = await createWorktree("/project", "HU-001");

    expect(result).toBe("/project/.kj/worktrees/HU-001");
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "/project/.kj/worktrees/HU-001", "-b", "kj-hu-HU-001"],
      { cwd: "/project" }
    );
  });

  it("removeWorktree calls git worktree remove --force", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });
    await removeWorktree("/project", "HU-001");

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "/project/.kj/worktrees/HU-001", "--force"],
      { cwd: "/project" }
    );
  });

  it("mergeWorktree merges branch, removes worktree, and deletes branch", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });
    await mergeWorktree("/project", "HU-001");

    expect(execFileAsyncMock).toHaveBeenCalledTimes(3);
    // merge
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "git", ["merge", "kj-hu-HU-001", "--no-edit"], { cwd: "/project" }
    );
    // remove worktree
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "git", ["worktree", "remove", "/project/.kj/worktrees/HU-001", "--force"], { cwd: "/project" }
    );
    // delete branch
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "git", ["branch", "-d", "kj-hu-HU-001"], { cwd: "/project" }
    );
  });
});

describe("parallel HU execution in sub-pipeline", () => {
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
    eventBase = { sessionId: "s_parallel", iteration: 0, stage: null, startedAt: Date.now() };
    events = [];
    emitter.on("progress", (evt) => events.push(evt));
  });

  it("single HU in a batch does not create worktree", async () => {
    const stories = [
      { id: "HU-001", status: "certified", certified: { text: "Solo task" }, original: { text: "Solo task" }, blocked_by: [] }
    ];
    const batch = { session_id: "hu-s_parallel", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    const result = await runHuSubPipeline({
      huReviewerResult: { ok: true, certified: 1, total: 1, stories, batchSessionId: "hu-s_parallel" },
      runIterationFn, emitter, eventBase, logger
    });

    expect(result.approved).toBe(true);
    expect(result.results).toHaveLength(1);
    // No worktree commands should have been called
    expect(execFileAsyncMock).not.toHaveBeenCalled();
  });

  it("failed HU in parallel batch does not block siblings", async () => {
    const stories = [
      { id: "HU-001", status: "certified", certified: { text: "Task A" }, original: { text: "Task A" }, blocked_by: [] },
      { id: "HU-002", status: "certified", certified: { text: "Task B" }, original: { text: "Task B" }, blocked_by: [] },
      { id: "HU-003", status: "certified", certified: { text: "Task C" }, original: { text: "Task C" }, blocked_by: [] }
    ];
    const batch = { session_id: "hu-s_parallel", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const runIterationFn = vi.fn(async (task) => {
      if (task === "Task B") return { approved: false, reason: "failed" };
      return { approved: true };
    });

    const result = await runHuSubPipeline({
      huReviewerResult: { ok: true, certified: 3, total: 3, stories, batchSessionId: "hu-s_parallel" },
      runIterationFn, emitter, eventBase, logger,
      config: { projectDir: "/project" }
    });

    // HU-002 failed but HU-001 and HU-003 should succeed (they're siblings)
    expect(result.approved).toBe(false);
    const approvedResults = result.results.filter(r => r.approved);
    expect(approvedResults).toHaveLength(2);

    const hu001 = result.results.find(r => r.huId === "HU-001");
    const hu002 = result.results.find(r => r.huId === "HU-002");
    const hu003 = result.results.find(r => r.huId === "HU-003");
    expect(hu001.approved).toBe(true);
    expect(hu002.approved).toBe(false);
    expect(hu003.approved).toBe(true);

    // All 3 were run (siblings continue despite failure)
    expect(runIterationFn).toHaveBeenCalledTimes(3);
  });

  it("failed HU blocks its dependents in next batch", async () => {
    const stories = [
      { id: "HU-001", status: "certified", certified: { text: "Base" }, original: { text: "Base" }, blocked_by: [] },
      { id: "HU-002", status: "certified", certified: { text: "Depends on base" }, original: { text: "Depends on base" }, blocked_by: ["HU-001"] }
    ];
    const batch = { session_id: "hu-s_parallel", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);

    const runIterationFn = vi.fn(async (task) => {
      if (task === "Base") return { approved: false, reason: "broken" };
      return { approved: true };
    });

    const result = await runHuSubPipeline({
      huReviewerResult: { ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_parallel" },
      runIterationFn, emitter, eventBase, logger
    });

    expect(result.approved).toBe(false);
    expect(result.blockedIds).toContain("HU-002");
    // HU-002 was never run because it was blocked
    expect(runIterationFn).toHaveBeenCalledTimes(1);
  });

  it("emits hu:parallel-start event with batch info", async () => {
    const stories = [
      { id: "HU-001", status: "certified", certified: { text: "A" }, original: { text: "A" }, blocked_by: [] },
      { id: "HU-002", status: "certified", certified: { text: "B" }, original: { text: "B" }, blocked_by: [] }
    ];
    const batch = { session_id: "hu-s_parallel", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const runIterationFn = vi.fn(async () => ({ approved: true }));

    await runHuSubPipeline({
      huReviewerResult: { ok: true, certified: 2, total: 2, stories, batchSessionId: "hu-s_parallel" },
      runIterationFn, emitter, eventBase, logger,
      config: { projectDir: "/project" }
    });

    const parallelEvents = events.filter(e => e.type === "hu:parallel-start");
    expect(parallelEvents).toHaveLength(1);
    expect(parallelEvents[0].detail.batchIds).toEqual(expect.arrayContaining(["HU-001", "HU-002"]));
    expect(parallelEvents[0].detail.parallel).toBe(true);
  });

  it("diamond dependency produces correct parallel batches", async () => {
    const stories = [
      { id: "A", status: "certified", certified: { text: "Task A" }, original: { text: "Task A" }, blocked_by: [] },
      { id: "B", status: "certified", certified: { text: "Task B" }, original: { text: "Task B" }, blocked_by: ["A"] },
      { id: "C", status: "certified", certified: { text: "Task C" }, original: { text: "Task C" }, blocked_by: ["A"] },
      { id: "D", status: "certified", certified: { text: "Task D" }, original: { text: "Task D" }, blocked_by: ["B", "C"] }
    ];
    const batch = { session_id: "hu-s_parallel", stories: [...stories] };
    loadHuBatchMock.mockResolvedValue(batch);
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const executionOrder = [];
    const runIterationFn = vi.fn(async (task) => {
      executionOrder.push(task);
      return { approved: true };
    });

    const result = await runHuSubPipeline({
      huReviewerResult: { ok: true, certified: 4, total: 4, stories, batchSessionId: "hu-s_parallel" },
      runIterationFn, emitter, eventBase, logger,
      config: { projectDir: "/project" }
    });

    expect(result.approved).toBe(true);
    expect(result.results).toHaveLength(4);
    expect(runIterationFn).toHaveBeenCalledTimes(4);

    // A must run before B and C; D must run after both B and C
    const indexA = executionOrder.indexOf("Task A");
    const indexB = executionOrder.indexOf("Task B");
    const indexC = executionOrder.indexOf("Task C");
    const indexD = executionOrder.indexOf("Task D");
    expect(indexA).toBeLessThan(indexB);
    expect(indexA).toBeLessThan(indexC);
    expect(indexB).toBeLessThan(indexD);
    expect(indexC).toBeLessThan(indexD);
  });
});
