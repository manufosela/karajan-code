import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const repairerRunMock = vi.fn();
const saveHuBatchMock = vi.fn(async () => {});

vi.mock("../../src/roles/repairer-role.js", () => ({
  RepairerRole: class {
    async init() {}
    async run(input) { return repairerRunMock(input); }
  },
}));

vi.mock("../../src/hu/store.js", () => ({
  saveHuBatch: (...a) => saveHuBatchMock(...a),
}));

const { runRepair } = await import("../../src/orchestrator/repair/repair-runner.js");

describe("repair-runner / runRepair", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn(), resetContext: vi.fn() };
  let emitter, events;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    events = [];
    emitter.on("progress", (e) => events.push(e));
  });

  function makeStory() {
    return {
      id: "HU-001",
      title: "Add audit script",
      scope: "Generates JSON report",
      acceptance_tests: [
        { type: "shell", content: "echo ok" },
        { type: "shell", content: "jq -e 'BROKEN' f.json" },
        { type: "shell", content: "ls" },
      ],
    };
  }

  it("returns repaired:true and patches in-memory + persists when verdict=fixable", async () => {
    const fixed = { type: "shell", content: "jq -e '.x == 1' f.json" };
    repairerRunMock.mockResolvedValueOnce({
      ok: true,
      result: { verdict: "fixable", fixed_test: fixed, reason: "rewrote jq" },
      summary: "Repairer: fixable — rewrote jq",
    });

    const story = makeStory();
    const batch = { session_id: "sid", stories: [story] };
    const planPatchMock = vi.fn(async () => {});

    const out = await runRepair({
      story, testIndex: 1, errorOutput: "Cannot index array with string",
      batchSessionId: "sid", batch,
      config: {}, logger, emitter, eventBase: { sessionId: "sid", iteration: 0, stage: null, startedAt: Date.now() },
      failureKind: "jq-as-binding-misuse",
      savePlanPatch: planPatchMock,
    });

    expect(out.repaired).toBe(true);
    expect(story.acceptance_tests[1]).toEqual(fixed);
    expect(saveHuBatchMock).toHaveBeenCalledWith("sid", batch);
    expect(planPatchMock).toHaveBeenCalledWith("HU-001", { acceptance_tests: story.acceptance_tests });
  });

  it("returns repaired:false + escalate:true when verdict=unfixable", async () => {
    repairerRunMock.mockResolvedValueOnce({
      ok: true,
      result: { verdict: "unfixable", fixed_test: null, reason: "intent mismatch" },
      summary: "Repairer: unfixable",
    });

    const story = makeStory();
    const before = JSON.parse(JSON.stringify(story.acceptance_tests));
    const batch = { session_id: "sid", stories: [story] };

    const out = await runRepair({
      story, testIndex: 1, errorOutput: "...",
      batchSessionId: "sid", batch,
      config: {}, logger, emitter, eventBase: { sessionId: "sid", iteration: 0, stage: null, startedAt: Date.now() },
      failureKind: "intent",
    });

    expect(out.repaired).toBe(false);
    expect(out.escalate).toBe(true);
    expect(out.reason).toBe("intent mismatch");
    // Story untouched.
    expect(story.acceptance_tests).toEqual(before);
    expect(saveHuBatchMock).not.toHaveBeenCalled();
  });

  it("returns repaired:false + escalate:false on Repairer agent error (caller decides)", async () => {
    repairerRunMock.mockRejectedValueOnce(new Error("provider down"));
    const story = makeStory();
    const batch = { session_id: "sid", stories: [story] };

    const out = await runRepair({
      story, testIndex: 1, errorOutput: "...",
      batchSessionId: "sid", batch,
      config: {}, logger, emitter, eventBase: { sessionId: "sid", iteration: 0, stage: null, startedAt: Date.now() },
      failureKind: "x",
    });

    expect(out.repaired).toBe(false);
    expect(out.escalate).toBeFalsy();
    expect(out.error).toMatch(/provider down/);
  });

  it("rejects an invalid story or testIndex without invoking the role", async () => {
    const out = await runRepair({
      story: { id: "X", acceptance_tests: [] }, testIndex: 99, errorOutput: "",
      batchSessionId: "sid", batch: { stories: [] },
      config: {}, logger, emitter, eventBase: {}, failureKind: "x",
    });
    expect(out.repaired).toBe(false);
    expect(out.error).toMatch(/invalid story or testIndex/);
    expect(repairerRunMock).not.toHaveBeenCalled();
  });

  it("emits repair:start and repair:end progress events", async () => {
    repairerRunMock.mockResolvedValueOnce({
      ok: true,
      result: { verdict: "fixable", fixed_test: { type: "shell", content: "x" }, reason: "x" },
      summary: "Repairer: fixable",
    });
    const story = makeStory();
    const batch = { session_id: "sid", stories: [story] };

    await runRepair({
      story, testIndex: 1, errorOutput: "err",
      batchSessionId: "sid", batch,
      config: {}, logger, emitter, eventBase: { sessionId: "sid", iteration: 0, stage: null, startedAt: Date.now() },
      failureKind: "x",
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("repair:start");
    expect(types).toContain("repair:end");
  });
});
