import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";

function resolveProvider(config) {
  return (
    config?.roles?.audit?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildSummary(parsed) {
  const { summary } = parsed;
  const parts = [];
  if (summary.critical > 0) parts.push(`${summary.critical} critical`);
  if (summary.high > 0) parts.push(`${summary.high} high`);
  if (summary.medium > 0) parts.push(`${summary.medium} medium`);
  if (summary.low > 0) parts.push(`${summary.low} low`);

  const findingsStr = parts.length > 0 ? parts.join(", ") : "no issues";
  return `Overall health: ${summary.overallHealth}. ${summary.totalFindings} findings (${findingsStr})`;
}

function resolveInput(input, context) {
  if (typeof input === "string") {
    return { task: input, onOutput: null, dimensions: null, context: null };
  }
  return {
    task: input?.task || context?.task || "",
    onOutput: input?.onOutput || null,
    dimensions: input?.dimensions || null,
    context: input?.context || null
  };
}

function parseDimensions(dimensionsStr) {
  if (!dimensionsStr || dimensionsStr === "all") return null;
  const requested = dimensionsStr.split(",").map(d => d.trim().toLowerCase());
  // Map "quality" shorthand to "codeQuality"
  const mapped = requested.map(d => d === "quality" ? "codeQuality" : d);
  const valid = mapped.filter(d => AUDIT_DIMENSIONS.includes(d));
  return valid.length > 0 ? valid : null;
}

export class AuditRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "audit", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, onOutput, dimensions: rawDimensions, context } = resolveInput(input, this.context);
    const dimensions = typeof rawDimensions === "string"
      ? parseDimensions(rawDimensions)
      : rawDimensions;
    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildAuditPrompt({ task, instructions: this.instructions, dimensions, context });
    const runArgs = { prompt, role: "audit" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: { error: result.error || result.output || "Audit failed", provider },
        summary: `Audit failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseAuditOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: { raw: result.output, provider },
          summary: "Audit complete (unstructured output)",
          usage: result.usage
        };
      }

      return {
        ok: true,
        result: {
          summary: parsed.summary,
          dimensions: parsed.dimensions,
          topRecommendations: parsed.topRecommendations,
          provider
        },
        summary: buildSummary(parsed),
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: { raw: result.output, provider },
        summary: "Audit complete (unstructured output)",
        usage: result.usage
      };
    }
  }
}
