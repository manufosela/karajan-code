/**
 * createArbiter — adapt ArbiterRole to the function the decision-resolver
 * injects (KJC-TSK-0573). The resolver calls `arbiter(req)` and expects
 * `{ choice, rationale, ... }`; here `choice` is the Arbiter's verdict, which
 * the resolver then validates against the caller's options (AUTO-A).
 */

import { ArbiterRole } from "./arbiter-role.js";

export function createArbiter({ config = {}, logger = console, createAgentFn = null } = {}) {
  return async function arbiter(req) {
    const role = new ArbiterRole({ config, logger, createAgentFn });
    const { result } = await role.execute(req);
    return {
      choice: result.verdict,
      rationale: result.rationale,
      confidence: result.confidence,
      defect: result.defect,
      directive: result.directive,
    };
  };
}
