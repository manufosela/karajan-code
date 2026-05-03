/**
 * Integrations registry — single site the orchestrator consults to talk to
 * external task trackers (Planning Game, future: GitHub Projects, Jira, …).
 *
 * TSK-0339 (KJC-PCS-0040) removes the direct coupling between
 * `src/orchestrator/` and `src/planning-game/`: pre-v2.7.5 there were 8
 * dynamic `await import("../../planning-game/…")` callsites scattered
 * across flow-runner, ci-integration, drivers, and architect-stage. Now
 * the orchestrator calls the registry instead of importing trackers:
 *
 *   const tracker = getIntegration("tracker");
 *   await tracker?.onCommit?.(session, commit);
 *
 * `src/planning-game/pipeline-adapter.js` registers itself once at
 * bootstrap (gated by `config.planning_game.enabled`). Adding a new
 * tracker means writing a single file under `src/adapters/…` with the
 * same hook surface; zero orchestrator edits.
 */

/**
 * Hook contract (all optional — callers use `adapter?.hook?.(args)`):
 *
 *   onSessionStart({ session, config, logger, pgTaskId, pgProject })
 *     → { pgCard } | void
 *   onCommit(session, commit)                              — fire-and-forget
 *   onSessionApproved({ session, config, gitResult, logger, pgCard, pgProject })
 *     → void
 *   buildHuStoriesFromCard(card)                           → HuStory[] | null
 *   handleDecomposition({ triageResult, ... })             → void
 *   createAdr({ title, context, decision, consequences })  → string | null
 *
 * No adapter is required to implement every hook — orchestrator callsites
 * use optional chaining so missing hooks are a silent skip.
 *
 * The registry itself is process-scoped (one map, mutated at bootstrap).
 * That's fine: adapter identity doesn't vary per-run — the same PG/Jira
 * backend serves every run in the process. Per-run tracker CONFIG (e.g.
 * different PG projects) is passed through the hook call, not by
 * swapping adapters.
 */

/** @type {Map<string, object>} */
const registry = new Map();

/**
 * Register an adapter under `name`. Idempotent: re-registering overwrites
 * the previous entry (tests use this to swap in fakes).
 *
 * @param {string} name
 * @param {object} adapter
 */
export function registerIntegration(name, adapter) {
  if (!name || typeof name !== "string") {
    throw new Error("registerIntegration: name must be a non-empty string");
  }
  registry.set(name, adapter);
}

/**
 * @param {string} name
 * @returns {object|undefined}
 */
export function getIntegration(name) {
  return registry.get(name);
}

/**
 * Remove an adapter. Tests use this to clear state between cases.
 * @param {string} name
 */
export function unregisterIntegration(name) {
  registry.delete(name);
}

/**
 * List registered integration names. Useful for bootstrap logging.
 * @returns {string[]}
 */
export function listIntegrations() {
  return [...registry.keys()];
}
