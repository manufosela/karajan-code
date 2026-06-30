// KJC-TSK-0569 (Onboard B) — the StartDecidor: the only LLM in the Brain's
// onboarding. Reads the deterministic assessment + user goal, picks ONE intent
// from a closed set, and never executes (0570 maps the intent to a safe command).
// Provider falls back to the coder, model defaults to haiku. Unparseable/unknown
// output degrades to ASK_USER so `kj start` always has a sane next step.
import { AgentRole } from "../roles/agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { buildStartDecisionPrompt, INTENTS } from "../prompts/start-decision.js";

const FALLBACK_QUESTION = "What would you like to do with this project?";

export class StartDecidorRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "start" });
  }

  extractInput(input) {
    const src = typeof input === "string" ? { userMessage: input } : input || {};
    return {
      userMessage: src.userMessage || "",
      assessment: src.assessment || "",
      onOutput: src.onOutput || null,
      ...src,
    };
  }

  async buildPrompt({ userMessage, assessment }) {
    return {
      prompt: buildStartDecisionPrompt({ userMessage, assessment, instructions: this.instructions }),
    };
  }

  parseOutput(raw) {
    return extractFirstJson(raw);
  }

  buildSuccessResult(parsed, provider) {
    const intent = INTENTS.has(parsed.intent) ? parsed.intent : "ASK_USER";
    const rationale = String(parsed.rationale || "").trim();
    const questionToAsk = String(parsed.questionToAsk || "").trim();
    const degraded = intent !== parsed.intent;
    return {
      intent,
      rationale: rationale || (degraded ? "Unrecognized intent, asking the user." : "No rationale provided."),
      questionToAsk: intent === "ASK_USER" ? questionToAsk || FALLBACK_QUESTION : "",
      provider,
    };
  }

  buildSummary(parsed) {
    const intent = INTENTS.has(parsed.intent) ? parsed.intent : "ASK_USER";
    return `Start decision: ${intent}`;
  }

  handleParseNull(agentResult, provider) {
    return this.degradedDecision({ agentResult, provider, reason: "no JSON found" });
  }

  handleParseError(err, agentResult, provider) {
    return this.degradedDecision({ agentResult, provider, reason: err?.message || "parse error" });
  }

  // Never block onboarding: garbage in → ask the user one open question.
  degradedDecision({ agentResult, provider, reason }) {
    this.logger?.warn?.(`[start] decider output unusable (${reason}) — asking the user.`);
    return {
      ok: true,
      result: {
        intent: "ASK_USER",
        rationale: `Could not read a decision (${reason}).`,
        questionToAsk: FALLBACK_QUESTION,
        provider,
        degraded: true,
      },
      summary: "Start decision: ASK_USER (fallback)",
      usage: agentResult.usage,
    };
  }
}
