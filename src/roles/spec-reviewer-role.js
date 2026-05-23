// Spec Reviewer role (KJC-PCS-0048 PR 1). Runs BEFORE intent/triage/planner;
// audits the user's spec and returns structured findings. Does NOT execute.

import { AgentRole } from "./agent-role.js";
import { buildSpecReviewerPrompt, buildSpecRefinerPrompt, VALID_CATEGORIES } from "../prompts/spec-reviewer.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

const F_SEVS = new Set(["info", "warn", "fail"]);
const T_SEVS = new Set(["ok", "info", "warn", "fail"]);
const CATS = new Set(VALID_CATEGORIES);
const ORDER = { ok: 0, info: 1, warn: 2, fail: 3 };

function normalise(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.map((f, i) => ({
    id: typeof f?.id === "string" && f.id.trim() ? f.id.trim() : `F-${String(i + 1).padStart(3, "0")}`,
    severity: F_SEVS.has(f?.severity) ? f.severity : "warn",
    category: CATS.has(f?.category) ? f.category : "ambiguity",
    message: String(f?.message || "").trim() || "(no description)",
    suggestion: typeof f?.suggestion === "string" && f.suggestion.trim() ? f.suggestion.trim() : null,
  }));
}

const worstOf = (findings) => findings.reduce((m, f) => (ORDER[f.severity] > ORDER[m] ? f.severity : m), "ok");

export class SpecReviewerRole extends AgentRole {
  constructor(opts) { super({ ...opts, name: "spec-reviewer" }); }

  extractInput(input) {
    if (typeof input === "string") return { spec: input, onOutput: null };
    return {
      spec: input?.spec || input?.task || this.context?.task || "",
      onOutput: input?.onOutput || null,
      sessionState: input?.sessionState || null,
    };
  }

  async buildPrompt({ spec }) {
    return { prompt: buildSpecReviewerPrompt({ spec, instructions: this.instructions }) };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  buildSuccessResult(parsed, provider) {
    const findings = normalise(parsed?.findings);
    const declared = T_SEVS.has(parsed?.severity) ? parsed.severity : null;
    const derived = worstOf(findings);
    // Trust the worse of declared vs derived — agents sometimes report
    // `severity: "ok"` while still listing fail-level findings.
    const severity = !declared || ORDER[derived] > ORDER[declared] ? derived : declared;
    return { severity, findings, reasoning: String(parsed?.reasoning || "").trim() || null, provider };
  }

  buildSummary(parsed) {
    const findings = normalise(parsed?.findings);
    if (findings.length === 0) return "Spec OK (no findings)";
    return `Spec ${worstOf(findings)}: ${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  }

  // Parse failures degrade to a soft warning so the pipeline never blocks.
  handleParseNull(r, p) { return this.#degraded(r, p, "parse-null", "LLM output was unstructured"); }
  handleParseError(e, r, p) { return this.#degraded(r, p, "parse-error", e?.message || "unknown"); }

  /**
   * Refine mode (KJC-PCS-0048 PR 3). Bypasses the JSON-only `execute()`
   * flow: returns the LLM output verbatim as the rewritten spec, so the
   * refine loop can persist it as `spec-v2.md`.
   * @returns {Promise<{ ok:boolean, refinedSpec?:string, error?:string, provider:string, usage?:object }>}
   */
  async refineSpec({ spec, findings }) {
    if (!this._initialized) await this.init({ task: spec });
    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const prompt = buildSpecRefinerPrompt({ originalSpec: spec, findings, instructions: this.instructions });
    const result = await withBrainRecovery({
      agent: { runTask: (a) => agent.runTask(a), provider },
      taskArgs: { prompt, role: this.name },
      role: this.name, provider, emitter: this.emitter, logger: this.logger,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || "refine failed", provider, usage: result.usage };
    }
    const refinedSpec = String(result.output || "").replace(/^```[a-z]*\n?|```$/g, "").trim();
    if (!refinedSpec) return { ok: false, error: "empty refined spec", provider, usage: result.usage };
    return { ok: true, refinedSpec, provider, usage: result.usage };
  }

  #degraded(agentResult, provider, reason, detail) {
    return {
      ok: true,
      result: {
        severity: "warn",
        findings: [{
          id: "F-DEG", severity: "warn", category: "assumptions",
          message: `[spec-reviewer] degraded (${reason}): ${detail}`,
          suggestion: "Re-run with --skip-spec-review if this keeps failing.",
        }],
        reasoning: "Spec reviewer could not parse the LLM output; treating as a soft warning.",
        provider, degraded: true,
      },
      summary: `Spec reviewer degraded: ${reason}`,
      usage: agentResult?.usage,
    };
  }
}
