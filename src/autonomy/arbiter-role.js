/**
 * ArbiterRole — the autonomous decision authority that resolves agent conflicts
 * by picking the least-bad verdict (KJC-TSK-0573, épica KJC-PCS-0062).
 *
 * Extends AgentRole (so it inherits Brain recovery / standby) following the
 * TriageRole pattern: a cheap decisor model emits a closed-set verdict, and any
 * parse failure degrades to BLOCK_AND_CONTINUE — the pipeline never crashes and
 * never blocks on the Arbiter.
 */

import { AgentRole } from "../roles/agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { buildArbiterPrompt, VERDICTS } from "../prompts/arbiter.js";

const CONSERVATIVE = "BLOCK_AND_CONTINUE";
const VERDICT_SET = new Set(VERDICTS);

function clampConfidence(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export class ArbiterRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "arbiter" });
  }

  async buildPrompt(input) {
    return { prompt: buildArbiterPrompt(input) };
  }

  parseOutput(raw) {
    return extractFirstJson(raw);
  }

  buildSuccessResult(parsed, provider) {
    const verdict = VERDICT_SET.has(parsed?.verdict) ? parsed.verdict : CONSERVATIVE;
    return {
      verdict,
      confidence: clampConfidence(parsed?.confidence),
      rationale: String(parsed?.rationale || "").trim() || "no rationale",
      defect: parsed?.defect ? String(parsed.defect).trim() : null,
      directive: parsed?.directive ? String(parsed.directive).trim() : null,
      provider,
    };
  }

  buildSummary(parsed) {
    return `Arbiter: ${VERDICT_SET.has(parsed?.verdict) ? parsed.verdict : CONSERVATIVE}`;
  }

  // Never crash on garbage: degrade to the conservative verdict so the pipeline
  // moves on instead of aborting (ok:true keeps the run alive).
  handleParseNull(agentResult, provider) {
    return this.degraded(agentResult, provider, "unstructured output");
  }

  handleParseError(err, agentResult, provider) {
    return this.degraded(agentResult, provider, err?.message || "parse error");
  }

  degraded(agentResult, provider, why) {
    this.logger?.warn?.(`[arbiter] ${why} → ${CONSERVATIVE} (conservative)`);
    return {
      ok: true,
      result: { verdict: CONSERVATIVE, confidence: 0, rationale: `degraded: ${why}`, defect: null, directive: null, provider },
      summary: `Arbiter: ${CONSERVATIVE} (degraded)`,
      usage: agentResult.usage,
    };
  }
}
