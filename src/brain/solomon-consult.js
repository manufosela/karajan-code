/**
 * Brain → Solomon consultation for routing decisions.
 *
 * When the Brain's Decision is low confidence, ambiguous, or the triage+config
 * combination yields conflicting signals, the Brain consults Solomon. Solomon
 * ruling is treated as *advisory*: if it returns a concrete role adjustment
 * (e.g. "add security"), Brain applies it; otherwise Brain keeps the baseline.
 *
 * This is intentionally conservative. A future iteration can make Solomon a
 * binding arbiter for routing (like it is for pipeline-control decisions).
 *
 * Architectural invariant: this module is the ONLY sanctioned path from
 * Brain to Solomon for routing concerns. Stages / rules / agents must not
 * bypass Brain to reach Solomon directly — see the note on `invokeSolomon`
 * in `src/orchestrator/solomon-escalation.js` and docs/ARCHITECTURE.md.
 *
 * @typedef {import("../types/solomon.js").Conflict} Conflict
 * @typedef {import("../types/solomon.js").SolomonResult} SolomonResult
 */

/**
 * Build a synthetic conflict payload suitable for invokeSolomon().
 *
 * @param {Object} args
 * @param {import("./decisor.js").Decision} args.decision
 * @param {Object} args.triage
 * @param {string} args.task
 * @returns {Conflict} conflict
 */
export function buildRoutingConflict({ decision, triage, task }) {
  return {
    task,
    stage: "brain-routing",
    reason: decision.solomonReason || "low-confidence routing decision",
    iterationCount: 0,
    maxIterations: 1,
    history: [],
    summary: `Brain rationale: ${decision.rationale}. Roles on: ${decision.rolesOn.join(", ")}. Confidence: ${decision.confidence}.`,
    // Extra data Solomon's prompt can introspect via conflict.detail
    detail: {
      triageLevel: triage?.level,
      triageTaskType: triage?.taskType,
      triageConfidence: triage?.confidence,
      rolesOn: decision.rolesOn,
      rolesOff: decision.rolesOff,
      reason: decision.solomonReason,
    },
  };
}

/**
 * Invoke Solomon with a routing question and translate its ruling back into
 * adjustments to the Decision's rolesOn/rolesOff lists.
 *
 * If anything goes wrong (Solomon disabled, invocation throws, ruling
 * malformed), the original decision is returned unchanged with a diagnostic
 * appended to its rationale.
 *
 * @param {Object} args
 * @param {import("./decisor.js").Decision} args.decision
 * @param {Object} args.triage
 * @param {string} args.task
 * @param {Object} args.config
 * @param {Object} args.logger
 * @param {Object} [args.emitter]
 * @param {Object} [args.eventBase]
 * @param {Object} [args.session]
 * @param {Function} [args.askQuestion]
 * @returns {Promise<import("./decisor.js").Decision>}
 */
export async function consultSolomonForRouting({
  decision,
  triage,
  task,
  config,
  logger,
  emitter = null,
  eventBase = {},
  session = {},
  askQuestion = null,
}) {
  if (!decision?.consultSolomon) return decision;
  // Route through the existing infrastructure.
  let invokeSolomon;
  try {
    ({ invokeSolomon } = await import("../orchestrator/solomon-escalation.js"));
  } catch (err) {
    logger?.warn?.(`brain/solomon-consult: escalation module unavailable (${err.message})`);
    return decision;
  }

  const conflict = buildRoutingConflict({ decision, triage, task });

  let ruling;
  try {
    ruling = await invokeSolomon({
      config,
      logger,
      emitter,
      eventBase,
      stage: "brain-routing",
      conflict,
      askQuestion,
      session,
      iteration: 0,
    });
  } catch (err) {
    logger?.warn?.(`brain/solomon-consult: invokeSolomon threw (${err.message}) — keeping baseline`);
    return {
      ...decision,
      rationale: `${decision.rationale} | solomon=failed(${err.message})`,
    };
  }

  if (!ruling || typeof ruling !== "object") {
    return {
      ...decision,
      rationale: `${decision.rationale} | solomon=no-ruling`,
    };
  }

  return applyRulingToDecision(decision, ruling, logger);
}

/**
 * Apply a Solomon ruling to a decision. Known ruling fields Solomon may
 * return that we understand in routing context:
 *   - action: "approve" / "continue" / "retry_different_approach" / "escalate"
 *   - suggestedActions: list of strings that may include "add X" / "remove X"
 *   - conditions: list of strings
 *
 * For routing we only look at suggestedActions (text-based) and parse simple
 * "add X" / "skip X" / "remove X" hints against the valid role set. Everything
 * else is logged for the rationale and ignored.
 */
export function applyRulingToDecision(decision, ruling, logger) {
  const rolesOn = new Set(decision.rolesOn);
  const rolesOff = new Set(decision.rolesOff);
  const applied = [];

  const suggestions = Array.isArray(ruling.suggestedActions) ? ruling.suggestedActions : [];
  for (const raw of suggestions) {
    const action = String(raw || "").toLowerCase();
    const addMatch = action.match(/\b(?:add|enable|include)\s+(\w+)/);
    const skipMatch = action.match(/\b(?:skip|disable|remove|drop)\s+(\w+)/);
    if (addMatch) {
      const role = addMatch[1];
      rolesOn.add(role);
      rolesOff.delete(role);
      applied.push(`solomon-add:${role}`);
    } else if (skipMatch) {
      const role = skipMatch[1];
      rolesOff.add(role);
      rolesOn.delete(role);
      applied.push(`solomon-skip:${role}`);
    }
  }

  const ruleVerdict = ruling.action || ruling.verdict || "unknown";
  logger?.info?.(`brain/solomon-consult: Solomon verdict=${ruleVerdict} applied=[${applied.join(",")}]`);

  return {
    ...decision,
    rolesOn: Array.from(rolesOn).sort((a, b) => a.localeCompare(b)),
    rolesOff: Array.from(rolesOff).sort((a, b) => a.localeCompare(b)),
    appliedOverrides: [...decision.appliedOverrides, ...applied],
    confidence: applied.length > 0 ? "high" : decision.confidence,
    consultSolomon: false,
    rationale: `${decision.rationale} | solomon=${ruleVerdict}${applied.length ? ` applied=${applied.join(",")}` : ""}`,
  };
}
