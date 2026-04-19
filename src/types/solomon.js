/**
 * Typedefs for Solomon — the AI judge consulted by Brain on genuine dilemmas.
 *
 * Architectural invariant (enforced by convention, see docs/ARCHITECTURE.md):
 *   Solomon is **NEVER** invoked directly from stages, rules or roles.
 *   The only legitimate entry points are:
 *     - `src/brain/solomon-consult.js#consultSolomonForRouting`
 *     - `src/orchestrator/solomon-escalation.js#invokeSolomon`
 *   Both are called by Brain (or by the orchestrator on Brain's behalf).
 *   The v2.3.0 audit fixed 21 violations where stages bypassed Brain and
 *   called Solomon directly. Don't reintroduce that pattern.
 *
 * This module is runtime-empty — it only carries JSDoc annotations.
 *
 * @module types/solomon
 */

/**
 * A single turn of feedback attributed to a pipeline agent. Used to build
 * `Conflict.history` when Brain escalates a decision to Solomon.
 *
 * @typedef {Object} ConflictHistoryEntry
 * @property {string} agent     - slug of the agent that produced the feedback
 *                                (e.g. "reviewer", "sonar", "tester",
 *                                "coder_rate_limit").
 * @property {string} feedback  - raw textual feedback to be weighted by Solomon.
 */

/**
 * The bundle of context Brain hands to Solomon when it cannot decide on its
 * own. Solomon reads only this object + the stage + task; it never sees
 * session internals beyond what is packed here.
 *
 * Historical shape: this matches the argument already used by
 * `invokeSolomon({ ..., conflict })` — the typedef formalizes the contract
 * so future drift is caught by `npm run typecheck`.
 *
 * @typedef {Object} Conflict
 * @property {string} stage
 *           Pipeline stage that triggered escalation (e.g. "reviewer",
 *           "sonar", "tester", "init_error", "coder_rate_limit").
 * @property {string} task
 *           Original user task (denormalized so Solomon sees what the user
 *           actually asked for, not just the stage context).
 * @property {number} iterationCount
 *           Current iteration number inside the escalating sub-loop.
 * @property {number} maxIterations
 *           Configured cap for that sub-loop (reviewer retries, tester
 *           retries, full pipeline iterations, etc.). Hitting this cap is
 *           the canonical trigger for Solomon consultation.
 * @property {string|null} [cooldownUntil]
 *           ISO timestamp for rate-limit / standby escalations. Null when
 *           the conflict is not a rate-limit.
 * @property {number|null} [cooldownMs]
 *           Remaining cooldown in milliseconds. Null outside rate-limit
 *           escalations.
 * @property {ConflictHistoryEntry[]} history
 *           Ordered list of agent feedback Solomon should weigh. Most
 *           recent last. Must be non-empty — Solomon should always see at
 *           least one piece of evidence.
 */

/**
 * Solomon's ruling on a `Conflict`. Returned by `invokeSolomon()` and
 * consumed by the orchestrator to decide what happens next.
 *
 * @typedef {Object} SolomonResult
 * @property {"continue"|"pause"|"subtask"} action
 *           - `continue`: retry the sub-loop with optional `humanGuidance`
 *             appended to the next feedback round.
 *           - `pause`: stop the pipeline and surface a question to the
 *             human operator (`SolomonResult.question`).
 *           - `subtask`: bifurcate into a named sub-task defined in
 *             `SolomonResult.subtask`.
 * @property {string} [rationale]         - human-readable reasoning for the
 *                                          chosen action. Logged to the
 *                                          decisions journal.
 * @property {string} [humanGuidance]     - text to merge into the next
 *                                          coder/reviewer prompt when
 *                                          action === "continue".
 * @property {string} [question]          - prompt shown to the human when
 *                                          action === "pause".
 * @property {Object} [subtask]           - sub-task descriptor when
 *                                          action === "subtask".
 */

export {};
