/**
 * Tracks every routing decision the Brain makes during a session and enforces
 * safety limits (max decisions per session, indecision-loop detection).
 *
 * Decisions are appended to `session.brainDecisions`. Consumers call
 * `recordDecision(tracker, decision, context)` after a buildDecision() call
 * and `checkLimits(tracker)` before making another decision.
 *
 * The limits are soft guards, not hard failures: hitting a limit surfaces
 * a status that the orchestrator can use to escalate to Solomon or pause
 * the session for human input.
 */

import { setBrainDecisions } from "../session/mutators.js";

export const DEFAULT_MAX_DECISIONS = 20;
export const INDECISION_REPEAT_THRESHOLD = 3; // 3 identical classifications in a row

/**
 * @typedef {Object} RecordedDecision
 * @property {number} seq
 * @property {string} at                            - ISO timestamp
 * @property {string} intent                        - e.g. "sw:medium" (taskType:level)
 * @property {string[]} rolesOn
 * @property {"low"|"medium"|"high"} confidence
 * @property {string} rationale
 * @property {string[]} appliedOverrides
 */

/**
 * @typedef {Object} TrackerStatus
 * @property {"ok"|"max-reached"|"indecision"} status
 * @property {number} decisionCount
 * @property {string} [detail]
 */

/**
 * Initialize a tracker bound to a session. If the session already has a
 * `brainDecisions` array (e.g. from a resumed session), keep it.
 *
 * @param {Object} session
 * @param {{ max?: number }} [options]
 * @returns {{ session: Object, max: number }}
 */
export function createTracker(session, { max = DEFAULT_MAX_DECISIONS } = {}) {
  if (!Array.isArray(session.brainDecisions)) {
    setBrainDecisions(session, []);
  }
  return { session, max };
}

/**
 * Append a decision to the tracker.
 *
 * @param {{ session: Object, max: number }} tracker
 * @param {Object} decision                         - output of buildDecision()
 * @param {{ taskType?: string, level?: string }} intent
 * @returns {RecordedDecision}
 */
export function recordDecision(tracker, decision, intent = {}) {
  const seq = tracker.session.brainDecisions.length + 1;
  const entry = {
    seq,
    at: new Date().toISOString(),
    intent: `${intent.taskType || "?"}:${intent.level || "?"}`,
    rolesOn: Array.isArray(decision.rolesOn) ? [...decision.rolesOn] : [],
    confidence: decision.confidence || "medium",
    rationale: decision.rationale || "",
    appliedOverrides: Array.isArray(decision.appliedOverrides) ? [...decision.appliedOverrides] : [],
  };
  tracker.session.brainDecisions.push(entry);
  return entry;
}

/**
 * Compute status of the tracker. Called BEFORE recording a new decision so
 * the orchestrator can decide to escalate instead of calling the Brain again.
 *
 * @param {{ session: Object, max: number }} tracker
 * @returns {TrackerStatus}
 */
export function checkLimits(tracker) {
  const decisions = tracker.session.brainDecisions || [];
  const decisionCount = decisions.length;

  if (decisionCount >= tracker.max) {
    return {
      status: "max-reached",
      decisionCount,
      detail: `Brain made ${decisionCount} decisions (limit ${tracker.max}). Escalate to Solomon or human.`,
    };
  }

  // Indecision loop: last N decisions share the exact same intent.
  const window = decisions.slice(-INDECISION_REPEAT_THRESHOLD);
  if (window.length >= INDECISION_REPEAT_THRESHOLD && window.every((d) => d.intent === window[0].intent)) {
    return {
      status: "indecision",
      decisionCount,
      detail: `Brain classified the same intent (${window[0].intent}) ${INDECISION_REPEAT_THRESHOLD} times in a row — loop detected.`,
    };
  }

  return { status: "ok", decisionCount };
}

/**
 * Build a short summary of all decisions made in the session. Useful for the
 * final report and for debugging.
 *
 * @param {{ session: Object }} tracker
 * @returns {{ total: number, byIntent: Record<string,number>, lastRationale: string }}
 */
export function summarize(tracker) {
  const decisions = tracker.session.brainDecisions || [];
  const byIntent = {};
  for (const d of decisions) {
    byIntent[d.intent] = (byIntent[d.intent] || 0) + 1;
  }
  return {
    total: decisions.length,
    byIntent,
    lastRationale: decisions.at(-1)?.rationale ?? "",
  };
}
