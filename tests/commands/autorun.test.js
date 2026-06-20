import { describe, expect, it, vi } from "vitest";

import { autorunCommand } from "../../src/commands/autorun.js";

const logger = { info: vi.fn(), error: vi.fn() };

describe("autorunCommand", () => {
  it("chains plan → run and defaults to autonomous, propagating ok", async () => {
    const planFn = vi.fn().mockResolvedValue({ ok: true, planId: "plan_x", ref: "FEAT-1", huCount: 3 });
    const runFn = vi.fn().mockResolvedValue({ ok: true });
    const res = await autorunCommand({ task: "build X", config: {}, logger, flags: {}, planFn, runFn });

    expect(res).toMatchObject({ ok: true, stage: "done", planId: "plan_x" });
    expect(planFn.mock.calls[0][0].flags.autonomous).toBe(true); // implied autonomous
    expect(runFn.mock.calls[0][0].flags.plan).toBe("plan_x"); // planId threaded into run
  });

  it("stops at the plan stage when planning fails (never runs)", async () => {
    const planFn = vi.fn().mockResolvedValue({ ok: false, reason: "spec-review-cancelled" });
    const runFn = vi.fn();
    const res = await autorunCommand({ task: "x", config: {}, logger, flags: {}, planFn, runFn });

    expect(res).toMatchObject({ ok: false, stage: "plan" });
    expect(runFn).not.toHaveBeenCalled();
  });

  it("reports ok:false when some HUs did not meet the ask", async () => {
    const planFn = vi.fn().mockResolvedValue({ ok: true, planId: "p", ref: "p", huCount: 2 });
    const runFn = vi.fn().mockResolvedValue({ ok: false });
    expect(await autorunCommand({ task: "x", config: {}, logger, flags: {}, planFn, runFn })).toMatchObject({ ok: false, stage: "run" });
  });

  it("builds a real outcome from the run's per-HU results (KJC-BUG-0090)", async () => {
    const planFn = vi.fn().mockResolvedValue({ ok: true, planId: "p", ref: "p", huCount: 2 });
    const runFn = vi.fn().mockResolvedValue({ ok: false, hus: [{ id: "h1", met: true }, { id: "h2", met: false }] });
    const res = await autorunCommand({ task: "x", config: {}, logger, flags: {}, planFn, runFn });
    expect(res.outcome).toMatchObject({ verdict: "INCOMPLETE", hus: { total: 2, met: 1, unmet: 1 } });
    expect(res.outcome.residualDefects).toHaveLength(1);
  });

  it("respects an explicit --autonomy level instead of forcing autonomous", async () => {
    const planFn = vi.fn().mockResolvedValue({ ok: true, planId: "p", ref: "p", huCount: 1 });
    const runFn = vi.fn().mockResolvedValue({ ok: true });
    await autorunCommand({ task: "x", config: {}, logger, flags: { autonomy: "assisted" }, planFn, runFn });
    expect(planFn.mock.calls[0][0].flags.autonomy).toBe("assisted");
    expect(planFn.mock.calls[0][0].flags.autonomous).toBeUndefined();
  });
});
