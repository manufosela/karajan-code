/**
 * Tracker bootstrap — registers the configured task-tracker adapter into
 * the orchestrator's integrations registry at runtime.
 *
 * This module exists so that `src/orchestrator/` never imports
 * `src/planning-game/` (or any other tracker) directly — the architecture
 * invariant `tests/architecture/tracker-coupling.test.js` enforces that.
 * `runFlow` calls `ensureTrackerRegistered(config)` from here; this
 * module owns the conditional import of each adapter.
 *
 * Adding a new tracker:
 *   1. Write `src/adapters/<name>/adapter.js` with the hook surface
 *      documented in `src/orchestrator/integrations.js`.
 *   2. Add a branch below that imports and registers it when the relevant
 *      config flag is true.
 *
 * The function is idempotent: once registered, subsequent calls are
 * no-ops (the registry already has an entry for the slot).
 */

import { getIntegration, registerIntegration } from "./orchestrator/integrations.js";

/**
 * Ensure the tracker adapter configured by `config` is registered under
 * the `"tracker"` slot. Safe to call on every `runFlow` invocation.
 *
 * @param {object|null} config
 * @returns {Promise<void>}
 */
export async function ensureTrackerRegistered(config) {
  if (getIntegration("tracker")) return; // Already registered.

  if (config?.planning_game?.enabled) {
    try {
      const { planningGameAdapter } = await import("./planning-game/pipeline-adapter.js");
      registerIntegration("tracker", planningGameAdapter);
    } catch { /* registration failed — non-blocking, adapter stays absent */ }
    return;
  }

  // No tracker enabled — the orchestrator's `getIntegration("tracker")`
  // calls will return undefined and every hook becomes an optional-chain
  // no-op. That's the intended behavior for "tracker disabled" runs.
}
