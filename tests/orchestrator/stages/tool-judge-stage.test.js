// KJC-TSK-0375 PR3 — Tests for the ToolJudgeStage.
import { describe, expect, it, vi } from "vitest";
import { runToolJudgeStage } from "../../../src/orchestrator/stages/tool-judge-stage.js";

const baseCtx = () => ({
  config: { roles: {} },
  logger: { setContext: vi.fn(), warn: vi.fn() },
  emitter: { emit: vi.fn() },
  eventBase: { runId: "r1" },
  session: { last_coder_transcript: "stub" },
  coderRole: { provider: "claude" },
  iteration: 0,
  task: { id: "t1", description: "do a thing" },
});

class FakeRole {
  constructor(opts) { FakeRole.lastOpts = opts; }
  async execute(input) {
    FakeRole.lastInput = input;
    return FakeRole.nextResult;
  }
}
FakeRole.nextResult = null;
FakeRole.lastOpts = null;
FakeRole.lastInput = null;

const fakeExtract = (calls) => vi.fn(() => calls);

describe("runToolJudgeStage", () => {
  it("emits events and returns stageResult on the OK happy path", async () => {
    const ctx = baseCtx();
    const calls = [{ tool: "Read", args: { file_path: "/x" } }];
    FakeRole.nextResult = { ok: true, result: { score: 88, threshold: 70, lowQuality: false, breakdown: [] }, summary: "Tool-judge: 88/100 (OK)", usage: { tokens_in: 10 } };
    const trackBudget = vi.fn();
    const out = await runToolJudgeStage({ ...ctx, trackBudget, extractFn: fakeExtract(calls), RoleClass: FakeRole });
    expect(out.action).toBe("ok");
    expect(out.stageResult).toMatchObject({ score: 88, lowQuality: false, callCount: 1 });
    expect(FakeRole.lastInput).toMatchObject({ toolCalls: calls, task: ctx.task });
    expect(trackBudget).toHaveBeenCalledWith("tool-judge", FakeRole.nextResult.usage);
    expect(ctx.emitter.emit).toHaveBeenCalled();
  });

  it("propagates lowQuality from the role result without blocking the iteration", async () => {
    const ctx = baseCtx();
    FakeRole.nextResult = { ok: true, result: { score: 40, threshold: 70, lowQuality: true, breakdown: [{ tool: "Bash", correct: false }] }, summary: "LOW" };
    const out = await runToolJudgeStage({ ...ctx, extractFn: fakeExtract([{ tool: "Bash", args: { command: "ls" } }]), RoleClass: FakeRole });
    expect(out.action).toBe("ok");
    expect(out.stageResult).toMatchObject({ lowQuality: true });
    expect(out.stageResult.breakdown).toHaveLength(1);
  });

  it("returns skipped stageResult when the role short-circuits on empty toolCalls", async () => {
    const ctx = baseCtx();
    ctx.session.last_coder_transcript = "";
    FakeRole.nextResult = { ok: true, result: { score: null, breakdown: [], skipped: true, lowQuality: false, threshold: 70 }, summary: "skipped" };
    const out = await runToolJudgeStage({ ...ctx, extractFn: fakeExtract([]), RoleClass: FakeRole });
    expect(out.stageResult).toMatchObject({ skipped: true, score: null, callCount: 0 });
  });

  it("passes the session transcript + coder provider to the extractor", async () => {
    const ctx = baseCtx();
    ctx.session.last_coder_transcript = "raw-transcript";
    ctx.coderRole.provider = "codex";
    FakeRole.nextResult = { ok: true, result: { score: 70, threshold: 70, lowQuality: false, breakdown: [] }, summary: "OK" };
    const extractFn = fakeExtract([]);
    await runToolJudgeStage({ ...ctx, extractFn, RoleClass: FakeRole });
    expect(extractFn).toHaveBeenCalledWith({ transcript: "raw-transcript", provider: "codex" });
  });

  it("survives a throwing trackBudget — best-effort accounting", async () => {
    const ctx = baseCtx();
    FakeRole.nextResult = { ok: true, result: { score: 90, threshold: 70, lowQuality: false, breakdown: [] }, summary: "OK", usage: { tokens_in: 1 } };
    const trackBudget = vi.fn(() => { throw new Error("boom"); });
    const out = await runToolJudgeStage({ ...ctx, trackBudget, extractFn: fakeExtract([{ tool: "Read", args: {} }]), RoleClass: FakeRole });
    expect(out.action).toBe("ok");
    expect(out.stageResult.score).toBe(90);
  });
});
