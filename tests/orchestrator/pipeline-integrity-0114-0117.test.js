// Regression tests for the false-green chain found in the complex demo
// (KJC-BUG-0114/0115/0116/0117). Each test pins one layer of the fix.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/orchestrator/drivers/iteration-phases/handle-approved.js", () => ({
  handleApprovedReview: vi.fn(),
}));
vi.mock("../../src/session/store.js", () => ({
  saveSession: vi.fn(),
  markSessionStatus: vi.fn(),
}));

import { finalizeMaxIterationsApproval, ensureIterationRecorded } from "../../src/orchestrator/drivers/iteration-loop.js";
import { handleApprovedReview } from "../../src/orchestrator/drivers/iteration-phases/handle-approved.js";
import { markSessionStatus } from "../../src/session/store.js";
import { createBudgetManager } from "../../src/orchestrator/config-init.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

function makeCtx() {
  return {
    config: { max_iterations: 5 },
    session: { id: "s_test", _journalIterations: [] },
    eventBase: {}, coderRole: {}, trackBudget: vi.fn(), stageResults: {},
    pipelineFlags: {}, gitCtx: {}, budgetSummary: vi.fn(() => ({})),
    pgCard: null, pgProject: null, rtkTracker: null, brainCtx: { enabled: true },
    journalIterations: true,
  };
}

describe("KJC-BUG-0116: approval at max_iterations runs the full finalize path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes brain_approved through handleApprovedReview (post-loop + git)", async () => {
    handleApprovedReview.mockResolvedValue({ action: "return", result: { approved: true, sessionId: "s_test" } });
    const out = await finalizeMaxIterationsApproval(makeCtx(), { approved: true, sessionId: "s_test", reason: "brain_approved" },
      { task: "t", askQuestion: vi.fn(), emitter: null, logger: noopLogger, i: 5 });
    expect(handleApprovedReview).toHaveBeenCalledTimes(1);
    expect(handleApprovedReview.mock.calls[0][0].review.approved).toBe(true);
    expect(out.approved).toBe(true);
  });

  it("reports failure honestly when post-loop rejects at max_iterations", async () => {
    handleApprovedReview.mockResolvedValue({ action: "continue" });
    const ctx = makeCtx();
    const out = await finalizeMaxIterationsApproval(ctx, { approved: true, sessionId: "s_test", reason: "brain_approved" },
      { task: "t", askQuestion: vi.fn(), emitter: null, logger: noopLogger, i: 5 });
    expect(out.approved).toBe(false);
    expect(out.reason).toBe("post_loop_rejected_at_max_iterations");
    expect(markSessionStatus).toHaveBeenCalledWith(ctx.session, "failed");
  });

  it("passes non-approved results through untouched", async () => {
    const result = { paused: true, sessionId: "s_test" };
    const out = await finalizeMaxIterationsApproval(makeCtx(), result,
      { task: "t", askQuestion: vi.fn(), emitter: null, logger: noopLogger, i: 5 });
    expect(out).toBe(result);
    expect(handleApprovedReview).not.toHaveBeenCalled();
  });
});

describe("KJC-BUG-0117: early-ended iterations still land in the journal", () => {
  it("records an entry when the iteration ended before the reviewer", async () => {
    const ctx = makeCtx();
    await ensureIterationRecorded(ctx, 1, noopLogger);
    expect(ctx.session._journalIterations).toHaveLength(1);
  });

  it("does not duplicate an iteration already recorded", async () => {
    const ctx = makeCtx();
    ctx.session._journalIterations = ["existing entry"];
    await ensureIterationRecorded(ctx, 1, noopLogger);
    expect(ctx.session._journalIterations).toHaveLength(1);
  });
});

describe("KJC-BUG-0114: budget ceiling resolution", () => {
  function eventsFor(maxBudget) {
    const events = [];
    const emitter = { emit: (name, ev) => events.push(ev) };
    const { trackBudget } = createBudgetManager({
      config: { max_budget_usd: maxBudget }, emitter, eventBase: {},
    });
    trackBudget({ role: "coder", provider: "claude", model: "m", result: { usage: {} }, duration_ms: 1 });
    return events.filter((e) => e.type === "budget:update");
  }

  it("null ceiling falls back to the shipped default, not $0.00", () => {
    const updates = eventsFor(null);
    expect(updates).toHaveLength(1);
    expect(updates[0].message).toMatch(/\/ \$5\.00/);
  });

  it("explicit 0 means no ceiling (no budget:update emitted)", () => {
    expect(eventsFor(0)).toHaveLength(0);
  });
});
