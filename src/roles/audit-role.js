import { AgentRole } from "./agent-role.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { measureBasalCost, loadPreviousAudit, saveAuditSnapshot, computeGrowthDelta } from "../audit/basal-cost.js";

function parseDimensions(dimensionsStr) {
  if (!dimensionsStr || dimensionsStr === "all") return null;
  const requested = dimensionsStr.split(",").map(d => d.trim().toLowerCase());
  const mapped = requested.map(d => d === "quality" ? "codeQuality" : d);
  const valid = mapped.filter(d => AUDIT_DIMENSIONS.includes(d));
  return valid.length > 0 ? valid : null;
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

export class AuditRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "audit" });
  }

  async execute(input) {
    const task = typeof input === "string" ? input : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;
    const rawDimensions = typeof input === "object" ? input?.dimensions || null : null;
    const context = typeof input === "object" ? input?.context || null : null;
    const dimensions = typeof rawDimensions === "string" ? parseDimensions(rawDimensions) : rawDimensions;

    const projectDir = this.config?.projectDir || process.cwd();
    let basalCost = null;
    let growthDelta = null;
    try {
      basalCost = await measureBasalCost(projectDir);
      const previous = await loadPreviousAudit(projectDir);
      growthDelta = computeGrowthDelta(basalCost, previous);
    } catch { /* basal cost is best-effort */ }

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const prompt = buildAuditPrompt({ task, instructions: this.instructions, dimensions, context, basalCost, growthDelta });
    const runArgs = { prompt, role: "audit" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return { ok: false, result: { error: result.error || result.output || "Audit failed", provider }, summary: `Audit failed: ${result.error || "unknown error"}`, usage: result.usage };
    }

    try {
      const parsed = parseAuditOutput(result.output);
      if (!parsed) {
        return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage: result.usage };
      }
      if (basalCost) { try { await saveAuditSnapshot(projectDir, basalCost); } catch { /* best-effort */ } }

      return {
        ok: true,
        result: {
          summary: parsed.summary, dimensions: parsed.dimensions,
          topRecommendations: parsed.topRecommendations,
          basalCost: basalCost || undefined, growthDelta: growthDelta || undefined, provider
        },
        summary: buildSummary(parsed),
        usage: result.usage
      };
    } catch {
      return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage: result.usage };
    }
  }
}
