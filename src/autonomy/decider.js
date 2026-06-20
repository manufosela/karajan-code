/**
 * buildDecider — wire the active autonomy level to a ready decision resolver
 * (KJC-TSK-0572, design in docs/specs/autonomous-delivery.md §5).
 *
 * interactive → the human `ask`; assisted/autonomous → the Arbiter (AUTO-B).
 * Consumers (spec-review, reviewer, checkpoint…) call `resolve(...)` instead of
 * prompting directly, so the autonomy level decides who answers in one place.
 */

import { createDecisionResolver } from "./decision-resolver.js";
import { resolveAutonomy } from "./policy.js";
import { createArbiter } from "./arbiter.js";

export function buildDecider({ config = {}, flags = {}, ask = null, env = process.env, logger = console, createAgentFn = null } = {}) {
  const autonomy = resolveAutonomy({ config, flags, env });
  const arbiter = autonomy === "interactive" ? null : createArbiter({ config, logger, createAgentFn });
  return { autonomy, resolve: createDecisionResolver({ autonomy, ask, arbiter, logger }) };
}
