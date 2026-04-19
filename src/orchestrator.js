/**
 * Orchestrator public API — thin barrel over the implementation in
 * src/orchestrator/flow-runner.js.
 *
 * Why this file is tiny: the 2 000-line monolith that used to live here was
 * extracted in KJC-TSK-0315 so that adding a new stage or routing rule no
 * longer requires touching a god-module. Consumers keep importing from
 * `src/orchestrator.js` — only the internal layout changed.
 *
 * See also:
 * - src/orchestrator/flow-runner.js         — runFlow + resumeFlow internals
 * - src/orchestrator/stages/stage-executor.js — the StageExecutor contract
 *   that individual stages can implement to register themselves with
 *   StageRegistry.
 */

export { runFlow, resumeFlow } from "./orchestrator/flow-runner.js";
export { loadProductContext } from "./orchestrator/config-init.js";
export {
  shouldAutoContinueCheckpoint,
  parseCheckpointAnswer
} from "./orchestrator/flow-control.js";
