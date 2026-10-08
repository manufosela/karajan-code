// KJC-TSK-0987 (issue #1894): the stage runs only with criteria, sends the
// uncovered ones back to the coder, and treats a judge with no verdict as a failure.
import { describe, expect, it, vi } from "vitest";
import { runAcceptanceCoverageStage, uncoveredFeedback } from "../../src/orchestrator/stages/acceptance-coverage-stage.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const eventBase = { sessionId: "s", iteration: 1, stage: null, startedAt: 0 };
const fakeRole = (output) => class {
  constructor() { this.calls = []; }
  async init() {}
  resolveProvider() { return "codex"; }
  async run(input) { fakeRole.lastInput = input; return output; }
};
const base = (RoleClass) => ({ config: { roles: {} }, logger, emitter: { emit: vi.fn() }, eventBase, trackBudget: vi.fn(), iteration: 1, task: "t", diff: "+ x", RoleClass });

describe("runAcceptanceCoverageStage", () => {
  it("without criteria it does not run and costs nothing", async () => {
    const RoleClass = vi.fn();
    expect(await runAcceptanceCoverageStage({ ...base(RoleClass), criteria: [] })).toEqual({ action: "skip" });
    expect(await runAcceptanceCoverageStage({ ...base(RoleClass), criteria: undefined })).toEqual({ action: "skip" });
    expect(RoleClass).not.toHaveBeenCalled();
  });

  it("all covered: ok, with the verdicts", async () => {
    const verdicts = [{ index: 1, text: "c1", covered: true, evidence: "a.js" }];
    const res = await runAcceptanceCoverageStage({ ...base(fakeRole({ ok: true, summary: "acceptance-coverage: 1/1 criteria covered", result: { criteria: verdicts, uncovered: [], provider: "codex" } })), criteria: ["c1"] });
    expect(res.action).toBe("ok");
    expect(res.stageResult).toMatchObject({ ok: true, criteria: verdicts, uncovered: [] });
    expect(fakeRole.lastInput).toMatchObject({ criteria: ["c1"], diff: "+ x" });
  });

  it("an uncovered criterion goes back to the coder as feedback", async () => {
    const uncovered = [{ index: 2, text: "c2", covered: false, evidence: "nothing touches the login" }];
    const res = await runAcceptanceCoverageStage({ ...base(fakeRole({ ok: true, summary: "acceptance-coverage: 1 of 2 criteria NOT covered", result: { criteria: [], uncovered, provider: "codex" } })), criteria: ["c1", "c2"] });
    expect(res.action).toBe("retry");
    expect(res.stageResult.ok).toBe(false);
    expect(res.feedback).toBe(uncoveredFeedback(uncovered));
    expect(res.feedback).toMatch(/\[2\] c2 \(judge: nothing touches the login\)/);
  });

  it("a judge with no verdict is a failure, never an approval", async () => {
    const res = await runAcceptanceCoverageStage({ ...base(fakeRole({ ok: false, summary: "acceptance-coverage output parse error: no JSON found", result: { error: "no JSON", provider: "codex" } })), criteria: ["c1"] });
    expect(res.action).toBe("fail");
    expect(res.stageResult).toMatchObject({ ok: false, error: "no JSON" });
  });
});
