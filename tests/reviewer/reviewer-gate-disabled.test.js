// KJC-BUG-0297 (#1993): with the reviewer disabled, the gate's stub used to read
// as a real approval ("Reviewer disabled by pipeline", approved:true) and the
// pipeline stamped a verdict nobody gave. The stub now says it reviewed nothing.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/orchestrator/stages/stage-executor.js", () => ({ runStage: vi.fn(async () => null) }));
vi.mock("../../src/orchestrator/stages/stage-classes.js", () => ({ stageRegistry: { get: () => ({}) } }));
vi.mock("../../src/orchestrator/drivers/error-recovery.js", () => ({ handleStandbyResult: vi.fn() }));

const { runReviewerGateStage } = await import("../../src/orchestrator/drivers/iteration-phases/reviewer-gate.js");

describe("reviewer gate with the reviewer disabled", () => {
  it("returns an approval that says nothing was reviewed", async () => {
    const r = await runReviewerGateStage({ pipelineFlags: { reviewerEnabled: false }, reviewerRole: { provider: "codex" }, config: {}, logger: { info: vi.fn() }, session: {}, i: 1 });
    expect(r.action).toBe("ok");
    expect(r.review).toMatchObject({ approved: true, reviewed: false, blocking_issues: [] });
    expect(r.review.summary).toMatch(/nothing was reviewed/);
  });
});
