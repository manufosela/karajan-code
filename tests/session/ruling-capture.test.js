import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Focused test: after invokeSolomon() produces a ruling, session.solomonRulings
 * must contain a journal-ready record. We mock SolomonRole to return a fixed
 * ruling and assert the capture contract.
 */

const solomonRun = vi.fn();

vi.mock("../../src/roles/solomon-role.js", () => ({
  SolomonRole: class {
    constructor() {}
    async init() {}
    async run(input) { return solomonRun(input); }
  },
}));

vi.mock("../../src/session/store.js", () => ({
  addCheckpoint: vi.fn().mockResolvedValue(undefined),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, detail) => ({ type, ...base, detail })),
}));

describe("solomon invocation → session.solomonRulings capture", () => {
  let invokeSolomon;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ invokeSolomon } = await import("../../src/orchestrator/solomon-escalation.js"));
  });

  it("appends a ruling record when Solomon returns approve", async () => {
    solomonRun.mockResolvedValue({
      ok: true,
      result: {
        ruling: "approve",
        reasoning: "Issues are stylistic, not functional.",
        conditions: [],
      },
      summary: "Solomon approve",
    });
    const session = { id: "s1", checkpoints: [] };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = { pipeline: { solomon: { enabled: true } }, roles: { solomon: { provider: "gemini" } } };
    const conflict = { task: "do X", stage: "reviewer", reason: "retry exhausted", summary: "3 iterations" };
    await invokeSolomon({ config, logger, emitter: null, eventBase: {}, stage: "reviewer", conflict, askQuestion: null, session, iteration: 2 });
    expect(session.solomonRulings).toHaveLength(1);
    expect(session.solomonRulings[0]).toMatchObject({
      stage: "reviewer",
      trigger: expect.stringContaining("retry exhausted"),
      ruling: "approve",
      reasoning: expect.stringContaining("stylistic"),
    });
  });

  it("records approve_with_conditions including the conditions array", async () => {
    solomonRun.mockResolvedValue({
      ok: true,
      result: {
        ruling: "approve_with_conditions",
        reasoning: "Ship with follow-up.",
        conditions: ["create follow-up for naming"],
      },
    });
    const session = { id: "s2", checkpoints: [] };
    const config = { pipeline: { solomon: { enabled: true } }, roles: { solomon: { provider: "gemini" } } };
    await invokeSolomon({
      config, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, emitter: null, eventBase: {},
      stage: "reviewer",
      conflict: { task: "x", stage: "reviewer", reason: "retry exhausted" },
      askQuestion: null, session, iteration: 0,
    });
    expect(session.solomonRulings[0].ruling).toBe("approve_with_conditions");
    expect(session.solomonRulings[0].conditions).toEqual(["create follow-up for naming"]);
  });

  it("appends multiple rulings when invokeSolomon is called more than once", async () => {
    solomonRun.mockResolvedValueOnce({ ok: true, result: { ruling: "approve", reasoning: "r1" } });
    solomonRun.mockResolvedValueOnce({ ok: true, result: { ruling: "create_subtask", reasoning: "r2", subtask: { title: "follow-up" } } });
    const session = { id: "s3", checkpoints: [] };
    const config = { pipeline: { solomon: { enabled: true } }, roles: { solomon: { provider: "gemini" } } };
    const base = { config, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, emitter: null, eventBase: {}, askQuestion: null, session };
    await invokeSolomon({ ...base, stage: "reviewer", conflict: { stage: "reviewer", reason: "first" }, iteration: 0 });
    await invokeSolomon({ ...base, stage: "coder", conflict: { stage: "coder", reason: "second" }, iteration: 1 });
    expect(session.solomonRulings).toHaveLength(2);
    expect(session.solomonRulings[0].ruling).toBe("approve");
    expect(session.solomonRulings[1].ruling).toBe("create_subtask");
  });
});
