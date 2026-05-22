import { describe, it, expect, vi, beforeEach } from "vitest";

// Resilience audit, Phase 3: a previous `kj run --plan` died mid-flight
// and left HUs stuck in `coding` / `reviewing` / `running` in the plan
// JSON. The board's hu-zombie-reaper only sees the SQLite mirror and
// only runs inside the board, so a headless `kj run --plan` later
// refused to pick those HUs up. The new reconciler resets them to
// `pending` when no live run owns the plan.

vi.mock("../../src/utils/run-registry.js", () => ({
  listActiveRuns: vi.fn(),
}));

const { listActiveRuns } = await import("../../src/utils/run-registry.js");
const { reconcilePlanHuZombies } = await import(
  "../../src/orchestrator/drivers/pre-loop-phases/inject-loaded-plan.js"
);

const logger = { warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcilePlanHuZombies", () => {
  it("resets coding/reviewing/running HUs to pending when no live run owns the plan", async () => {
    listActiveRuns.mockReturnValue([]);
    const plan = { hus: [
      { id: "hu1", status: "coding" },
      { id: "hu2", status: "reviewing" },
      { id: "hu3", status: "running" },
      { id: "hu4", status: "pending" },
      { id: "hu5", status: "approved" },
    ] };

    const reaped = await reconcilePlanHuZombies({ loadedPlan: plan, planId: "plan-x", logger });

    expect(reaped).toBe(3);
    expect(plan.hus.map((h) => h.status)).toEqual([
      "pending", "pending", "pending", "pending", "approved",
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it("does NOT touch HUs when a live run already owns the plan", async () => {
    listActiveRuns.mockReturnValue([{ pid: 1234, planId: "plan-x" }]);
    const plan = { hus: [{ id: "hu1", status: "coding" }] };

    const reaped = await reconcilePlanHuZombies({ loadedPlan: plan, planId: "plan-x", logger });

    expect(reaped).toBe(0);
    expect(plan.hus[0].status).toBe("coding");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns 0 for a plan with no HUs / a malformed input", async () => {
    expect(await reconcilePlanHuZombies({ loadedPlan: { hus: [] }, planId: "x" })).toBe(0);
    expect(await reconcilePlanHuZombies({ loadedPlan: {}, planId: "x" })).toBe(0);
    expect(await reconcilePlanHuZombies({ loadedPlan: null, planId: "x" })).toBe(0);
  });

  it("leaves already-terminal statuses untouched (failed / pending / approved)", async () => {
    listActiveRuns.mockReturnValue([]);
    const plan = { hus: [
      { id: "h1", status: "pending" },
      { id: "h2", status: "approved" },
      { id: "h3", status: "failed" },
    ] };
    const reaped = await reconcilePlanHuZombies({ loadedPlan: plan, planId: "x", logger });
    expect(reaped).toBe(0);
  });
});
