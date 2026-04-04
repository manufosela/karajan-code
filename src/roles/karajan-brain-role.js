import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";

const BRAIN_PREAMBLE = [
  "You are Karajan Brain, the central orchestrator of a multi-agent AI coding pipeline.",
  "You receive the output of a role that just completed and decide what happens next.",
  "Your decisions MUST be intelligent, context-aware, and token-efficient.",
  "Do NOT execute the task yourself — you route, enrich, and control the flow."
].join(" ");

/**
 * KarajanBrainRole — AI-powered central orchestrator.
 * Receives role outputs and decides: next role, enriched prompt, direct actions.
 * Only consults Solomon when facing a genuine dilemma.
 */
export class KarajanBrainRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "karajan-brain" });
  }

  resolveProvider() {
    return (
      this.config?.roles?.["karajan-brain"]?.provider ||
      this.config?.brain?.provider ||
      this.config?.roles?.coder?.provider ||
      "claude"
    );
  }

  extractInput(input) {
    return {
      currentRole: input?.currentRole || null,
      roleOutput: input?.roleOutput || null,
      pipelineState: input?.pipelineState || {},
      availableRoles: input?.availableRoles || [],
      task: input?.task || this.context?.task || "",
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ currentRole, roleOutput, pipelineState, availableRoles, task }) {
    const sections = [BRAIN_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);

    sections.push(
      "## Current pipeline state",
      `Task: ${task}`,
      `Last role executed: ${currentRole || "none"}`,
      `Available roles: ${availableRoles.join(", ") || "coder, reviewer, tester, security"}`,
      `Iteration: ${pipelineState.iteration || 0}/${pipelineState.maxIterations || 5}`
    );

    if (pipelineState.filesChanged != null) {
      sections.push(`Files changed so far: ${pipelineState.filesChanged}`);
    }
    if (pipelineState.budget) {
      sections.push(`Budget used: $${pipelineState.budget.cost_usd?.toFixed(2) || 0}`);
    }

    if (roleOutput) {
      const outputStr = typeof roleOutput === "string" ? roleOutput : JSON.stringify(roleOutput, null, 2);
      const truncated = outputStr.length > 3000 ? outputStr.slice(0, 3000) + "...[truncated]" : outputStr;
      sections.push(`## Output from ${currentRole}`, truncated);
    }

    sections.push(
      "## Your decision",
      "Return a single JSON object with your routing decision:",
      "```json",
      "{",
      '  "nextRole": "coder|reviewer|tester|security|solomon|done",',
      '  "enrichedPrompt": "string with specific instructions for the next role, or null to use default",',
      '  "directActions": [{"type": "run_command|create_file|update_gitignore", "params": {}}],',
      '  "reasoning": "why this decision",',
      '  "consultSolomon": false,',
      '  "dilemma": null',
      "}",
      "```",
      "",
      "Guidelines:",
      "- If coder produced 0 file changes and there's reviewer feedback: enrich the prompt with concrete file paths and resend to coder",
      "- If tests are failing but node_modules missing: directAction to run npm install",
      '- If you cannot decide or face a genuine dilemma (security vs deadline, conflicting gates): set consultSolomon=true and describe the dilemma',
      "- If the pipeline should end (approved, max iterations, unrecoverable): set nextRole=done"
    );

    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) {
    return extractFirstJson(raw);
  }

  buildSuccessResult(parsed, provider) {
    return {
      nextRole: parsed.nextRole || "coder",
      enrichedPrompt: parsed.enrichedPrompt || null,
      directActions: Array.isArray(parsed.directActions) ? parsed.directActions : [],
      reasoning: parsed.reasoning || "",
      consultSolomon: Boolean(parsed.consultSolomon),
      dilemma: parsed.dilemma || null,
      provider
    };
  }

  buildSummary(parsed) {
    const next = parsed.nextRole || "unknown";
    const actions = Array.isArray(parsed.directActions) ? parsed.directActions.length : 0;
    const solomon = parsed.consultSolomon ? " (consulting Solomon)" : "";
    return `Brain: next=${next}, ${actions} direct action(s)${solomon}`;
  }

  handleParseNull(agentResult, provider) {
    // Fallback: continue with default flow
    return {
      ok: true,
      result: {
        nextRole: "coder",
        enrichedPrompt: null,
        directActions: [],
        reasoning: "Unstructured output — falling back to default flow",
        consultSolomon: false,
        dilemma: null,
        provider
      },
      summary: "Brain: fallback to default flow (unstructured output)",
      usage: agentResult.usage
    };
  }

  handleParseError(_err, agentResult, provider) {
    return this.handleParseNull(agentResult, provider);
  }
}
