/**
 * autonomy/policy — autonomy levels for Autonomous Delivery (KJC-TSK-0572,
 * épica KJC-PCS-0062, design in docs/specs/autonomous-delivery.md §4).
 *
 * One configurable axis decides who resolves a pipeline question:
 *   interactive — the human (current behaviour, default)
 *   assisted    — the human only for high-risk decisions, the Arbiter otherwise
 *   autonomous  — always the Arbiter; never asks a human, never blocks
 *
 * Precedence (most specific wins): CLI flags → env → config → default.
 */

export const AUTONOMY_LEVELS = Object.freeze(["interactive", "assisted", "autonomous"]);

/** Risk of a decision — drives whether `assisted` escalates to the human. */
export const RISK = Object.freeze({ LOW: "low", HIGH: "high" });

const DEFAULT_LEVEL = "interactive";

/**
 * Resolve the active autonomy level. `--autonomous` is sugar for the
 * `autonomous` level; `--autonomy <level>` sets it explicitly. An unknown
 * value degrades to the safe default rather than throwing.
 */
export function resolveAutonomy({ config = {}, flags = {}, env = {} } = {}) {
  const raw =
    flags.autonomy ??
    (flags.autonomous ? "autonomous" : null) ??
    env.KJ_AUTONOMY ??
    config.autonomy ??
    DEFAULT_LEVEL;
  const level = String(raw).toLowerCase();
  return AUTONOMY_LEVELS.includes(level) ? level : DEFAULT_LEVEL;
}

/** True when the level should route decisions to the Arbiter for `risk`. */
export function usesArbiter(level, risk = RISK.LOW) {
  if (level === "autonomous") return true;
  if (level === "assisted") return risk !== RISK.HIGH;
  return false; // interactive
}
