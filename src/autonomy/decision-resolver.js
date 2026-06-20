/**
 * autonomy/decision-resolver — the single choke point for every pipeline
 * question (KJC-TSK-0572, design in docs/specs/autonomous-delivery.md §5).
 *
 * Today the "ask a human" logic is scattered (spec-review, checkpoint,
 * reviewer, board-bridge). This unifies it: callers ask `resolveDecision`
 * instead of prompting directly, and the autonomy level decides who answers —
 * the human (`ask`) or the Arbiter (`arbiter`, injected by AUTO-B).
 *
 * INVARIANT: in `autonomous` mode the resolver NEVER returns a null choice and
 * NEVER blocks — if the Arbiter can't decide it degrades to the option flagged
 * `conservative` (or the first option). Decisions are always traced.
 */

import { RISK, usesArbiter } from "./policy.js";

/** Pick the safe fallback: the option flagged conservative, else the first. */
function conservativeOf(options) {
  return options.find((o) => o.conservative) ?? options[0] ?? null;
}

function decision(choice, rationale, source) {
  return { choice: choice ?? null, rationale, source };
}

/**
 * Build a resolver bound to an autonomy level and its two answer sources.
 *
 * @param {object} opts
 * @param {string} opts.autonomy - interactive | assisted | autonomous
 * @param {(question: string, context?: object) => Promise<string|null>} [opts.ask] - human prompt
 * @param {(input: object) => Promise<{choice: string, rationale?: string}>} [opts.arbiter] - AUTO-B
 * @returns {(req: object) => Promise<{choice, rationale, source}>}
 */
export function createDecisionResolver({ autonomy = "interactive", ask = null, arbiter = null, logger = console } = {}) {
  return async function resolveDecision({ question, options = [], context = null, risk = RISK.LOW } = {}) {
    const fallback = conservativeOf(options);

    // Human path: interactive, or assisted with a high-risk decision.
    if (!usesArbiter(autonomy, risk)) {
      const answer = ask ? await ask(question, context) : null;
      return decision(answer, "human", "human");
    }

    // Arbiter path: must always yield a valid choice, never block.
    if (!arbiter) return decision(fallback?.value, "no arbiter available → conservative", "fallback");
    let verdict;
    try {
      verdict = await arbiter({ question, options, context, risk });
    } catch (err) {
      logger.warn?.(`decision-resolver: arbiter failed (${err.message}) → conservative`);
      return decision(fallback?.value, "arbiter error → conservative", "fallback");
    }
    const valid = verdict && options.some((o) => o.value === verdict.choice);
    if (!valid) return decision(fallback?.value, "arbiter gave no valid choice → conservative", "fallback");
    return decision(verdict.choice, verdict.rationale ?? "arbiter", "arbiter");
  };
}
