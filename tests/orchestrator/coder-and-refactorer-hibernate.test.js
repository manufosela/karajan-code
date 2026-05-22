import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1 (PR 2/4) of the resilience audit: when the coder or refactorer
// stage hits a provider quota cap, Brain Recovery hibernates the run and
// the stage returns `action:"hibernate"`. runCoderAndRefactorerStages must
// turn that into a clean loop return carrying `hibernated:true` — so the
// session is sealed `hibernated`, NOT `failed`, and stays resumable.

vi.mock("../../src/orchestrator/stages/stage-executor.js", () => ({
  runStage: vi.fn(),
}));
vi.mock("../../src/orchestrator/stages/stage-classes.js", () => ({
  stageRegistry: { get: vi.fn(() => ({})) },
}));
vi.mock("../../src/orchestrator/iteration-stages.js", () => ({
  runRefactorerStage: vi.fn(),
}));
vi.mock("../../src/orchestrator/drivers/error-recovery.js", () => ({
  handleStandbyResult: vi.fn(async () => ({ handled: false })),
}));

const { runStage } = await import("../../src/orchestrator/stages/stage-executor.js");
const { runRefactorerStage } = await import("../../src/orchestrator/iteration-stages.js");
const { runCoderAndRefactorerStages } = await import(
  "../../src/orchestrator/drivers/iteration-phases/coder-and-refactorer.js"
);

function baseArgs(overrides = {}) {
  return {
    coderRoleInstance: {}, coderRole: {}, refactorerRole: {},
    pipelineFlags: { refactorerEnabled: false },
    config: {}, logger: {}, emitter: null, eventBase: {},
    session: { id: "s_quota" }, plannedTask: "do the thing",
    trackBudget: () => {}, i: 1, brainCtx: {},
    ...overrides,
  };
}

describe("runCoderAndRefactorerStages — hibernation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coder hibernate → { action:'return', result.hibernated:true }", async () => {
    runStage.mockResolvedValue({
      action: "hibernate", standbyFile: "/tmp/standby/s_quota.json",
      recovery: { class: "QUOTA_EXHAUSTED_DAILY" },
    });
    const r = await runCoderAndRefactorerStages(baseArgs());
    expect(r.action).toBe("return");
    expect(r.result.hibernated).toBe(true);
    expect(r.result.sessionId).toBe("s_quota");
    expect(r.result.reason).toBe("quota_exhausted");
    expect(r.result.standbyFile).toBe("/tmp/standby/s_quota.json");
  });

  it("refactorer hibernate is also turned into a clean return", async () => {
    runStage.mockResolvedValue({ action: "ok" });
    runRefactorerStage.mockResolvedValue({
      action: "hibernate", standbyFile: "/tmp/standby/s_quota.json", recovery: {},
    });
    const r = await runCoderAndRefactorerStages(baseArgs({
      pipelineFlags: { refactorerEnabled: true },
    }));
    expect(r.action).toBe("return");
    expect(r.result.hibernated).toBe(true);
  });

  it("a normal coder result is unaffected (no hibernation)", async () => {
    runStage.mockResolvedValue({ action: "ok" });
    const r = await runCoderAndRefactorerStages(baseArgs());
    expect(r.action).toBe("ok");
  });
});
