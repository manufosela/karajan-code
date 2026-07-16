/**
 * parallel-limiter — shared concurrency coordinator for parallel HU
 * execution (KJC-TSK-0624, épica KJC-PCS-0065). One instance per plan run,
 * shared by every HU lane:
 *
 *   - Semaphore: at most maxParallel HUs hold a slot (acquire/release).
 *   - Plan budget: the whole run shares ONE BudgetTracker; the launch gate
 *     refuses new lanes once aggregated spend reaches the plan ceiling
 *     (maxParallel × max_budget_usd — parallelism scales the cap, it never
 *     multiplies it silently).
 *   - Cooldown: when any lane hits a provider rate limit it calls
 *     notifyCooldown(ms); NEW launches pause until it expires while lanes
 *     already flying finish their work — parallel retry stampedes are the
 *     fastest way to burn a quota.
 */

export function createParallelLimiter({ maxParallel = 1, budgetTracker = null, planBudgetUsd = null, now = Date.now } = {}) {
  let inUse = 0;
  let cooldownUntil = 0;
  const waiters = [];

  const overPlanBudget = () => {
    if (planBudgetUsd == null || !budgetTracker) return false;
    return (budgetTracker.total?.().cost_usd ?? 0) >= Number(planBudgetUsd);
  };

  const grantNext = () => {
    while (waiters.length > 0 && inUse < maxParallel) {
      inUse += 1;
      waiters.shift()();
    }
  };

  return {
    /** Why a new lane may not launch right now; null = clear to go. */
    launchBlockReason() {
      if (overPlanBudget()) {
        return `plan budget exhausted ($${(budgetTracker.total().cost_usd).toFixed(2)} ≥ $${Number(planBudgetUsd).toFixed(2)})`;
      }
      const waitMs = cooldownUntil - now();
      if (waitMs > 0) return `provider cooldown for ${Math.ceil(waitMs / 1000)}s`;
      return null;
    },

    /** Wait for a free slot. Resolves when this lane may run. */
    acquire() {
      if (inUse < maxParallel) {
        inUse += 1;
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push(resolve));
    },

    release() {
      inUse = Math.max(0, inUse - 1);
      grantNext();
    },

    /** A lane hit a rate limit: pause NEW launches until it expires. */
    notifyCooldown(ms) {
      cooldownUntil = Math.max(cooldownUntil, now() + Math.max(0, ms));
    },

    stats() {
      return { inUse, waiting: waiters.length, maxParallel, cooldownUntil };
    },
  };
}

/** Plan-level ceiling: parallelism scales the per-run cap, explicitly. */
export function planBudgetUsd({ maxBudgetUsd, maxParallel = 1 }) {
  if (maxBudgetUsd == null) return null;
  return Number(maxBudgetUsd) * Math.max(1, maxParallel);
}
