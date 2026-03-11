import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildDiscoverPrompt, parseDiscoverOutput } from "../prompts/discover.js";

function resolveProvider(config) {
  return (
    config?.roles?.discover?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildSummary(parsed, mode) {
  const gapCount = parsed.gaps?.length || 0;
  if (gapCount === 0 && mode !== "wendel") return "Discovery complete: task is ready";
  const parts = [];
  if (gapCount > 0) parts.push(`${gapCount} gap${gapCount !== 1 ? "s" : ""} found`);
  if (mode === "momtest") {
    const qCount = parsed.momTestQuestions?.length || 0;
    if (qCount > 0) parts.push(`${qCount} Mom Test question${qCount !== 1 ? "s" : ""}`);
  }
  if (mode === "wendel") {
    const failCount = (parsed.wendelChecklist || []).filter(c => c.status === "fail").length;
    if (failCount > 0) parts.push(`${failCount} Wendel condition${failCount !== 1 ? "s" : ""} failed`);
    else if (gapCount === 0) return "Discovery complete: task is ready";
  }
  return `Discovery complete: ${parts.join(", ")} (verdict: ${parsed.verdict})`;
}

export class DiscoverRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "discover", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = typeof input === "string"
      ? input
      : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;
    const mode = (typeof input === "object" ? input?.mode : null) || "gaps";
    const context = typeof input === "object" ? input?.context || null : null;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildDiscoverPrompt({ task, instructions: this.instructions, mode, context });
    const runArgs = { prompt, role: "discover" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Discovery failed",
          provider,
          mode
        },
        summary: `Discovery failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseDiscoverOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: {
            verdict: "ready",
            gaps: [],
            mode,
            raw: result.output,
            provider
          },
          summary: "Discovery complete (unstructured output)",
          usage: result.usage
        };
      }

      const resultObj = {
        verdict: parsed.verdict,
        gaps: parsed.gaps,
        mode,
        provider
      };
      if (mode === "momtest") {
        resultObj.momTestQuestions = parsed.momTestQuestions || [];
      }
      if (mode === "wendel") {
        resultObj.wendelChecklist = parsed.wendelChecklist || [];
      }

      return {
        ok: true,
        result: resultObj,
        summary: buildSummary(parsed, mode),
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: {
          verdict: "ready",
          gaps: [],
          mode,
          raw: result.output,
          provider
        },
        summary: "Discovery complete (unstructured output)",
        usage: result.usage
      };
    }
  }
}
