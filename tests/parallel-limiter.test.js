import { describe, expect, it, vi } from "vitest";

import { createParallelLimiter, planBudgetUsd } from "../src/orchestrator/parallel-limiter.js";

const tracker = (usd) => ({ total: () => ({ cost_usd: usd }) });

describe("parallel-limiter (KJC-TSK-0624)", () => {
  it("planBudgetUsd scales the per-run cap by the parallelism, explicitly", () => {
    expect(planBudgetUsd({ maxBudgetUsd: 5, maxParallel: 3 })).toBe(15);
    expect(planBudgetUsd({ maxBudgetUsd: 5 })).toBe(5);
    expect(planBudgetUsd({ maxBudgetUsd: null, maxParallel: 3 })).toBeNull();
  });

  it("semaphore: grants up to maxParallel and queues the rest until release", async () => {
    const lim = createParallelLimiter({ maxParallel: 2 });
    await lim.acquire();
    await lim.acquire();
    let third = false;
    const pending = lim.acquire().then(() => (third = true));
    await new Promise((r) => setImmediate(r));
    expect(third).toBe(false);
    expect(lim.stats()).toMatchObject({ inUse: 2, waiting: 1 });

    lim.release();
    await pending;
    expect(third).toBe(true);
    expect(lim.stats()).toMatchObject({ inUse: 2, waiting: 0 });
  });

  it("blocks new launches when the shared plan budget is exhausted", () => {
    const lim = createParallelLimiter({ maxParallel: 2, budgetTracker: tracker(15.2), planBudgetUsd: 15 });
    expect(lim.launchBlockReason()).toContain("plan budget exhausted");
    const ok = createParallelLimiter({ maxParallel: 2, budgetTracker: tracker(3), planBudgetUsd: 15 });
    expect(ok.launchBlockReason()).toBeNull();
  });

  it("cooldown pauses NEW launches until it expires, without touching in-flight slots", () => {
    let t = 1000;
    const lim = createParallelLimiter({ maxParallel: 2, now: () => t });
    lim.notifyCooldown(30_000);
    expect(lim.launchBlockReason()).toContain("cooldown for 30s");
    // A shorter later cooldown never shrinks the pause.
    lim.notifyCooldown(5_000);
    expect(lim.launchBlockReason()).toContain("cooldown for 30s");
    t += 31_000;
    expect(lim.launchBlockReason()).toBeNull();
  });

  it("release below zero is clamped and keeps granting correctly", async () => {
    const lim = createParallelLimiter({ maxParallel: 1 });
    lim.release(); // spurious release must not corrupt the counter
    await lim.acquire();
    expect(lim.stats().inUse).toBe(1);
    const spy = vi.fn();
    const pending = lim.acquire().then(spy);
    lim.release();
    await pending;
    expect(spy).toHaveBeenCalled();
  });
});
