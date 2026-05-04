import { AgentRole } from "./agent-role.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { measureBasalCost, loadPreviousAudit, saveAuditSnapshot, computeGrowthDelta } from "../audit/basal-cost.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { collectSonarFindings } from "../audit/sonar-findings.js";
import { collectWebPerfInput } from "../audit/webperf-input.js";

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
    const noSonar = typeof input === "object" ? Boolean(input?.noSonar) : false;
    const dimensions = typeof rawDimensions === "string" ? parseDimensions(rawDimensions) : rawDimensions;

    const projectDir = this.config?.projectDir || process.cwd();
    let basalCost = null;
    let growthDelta = null;
    let stack = null;
    let sonarFindings = null;
    try {
      basalCost = await measureBasalCost(projectDir);
      const previous = await loadPreviousAudit(projectDir);
      growthDelta = computeGrowthDelta(basalCost, previous);
    } catch { /* basal cost is best-effort */ }
    // Stack detection — KJC-TSK-0358. Best-effort: a project without
    // package.json or recognisable language markers gets stack=null and the
    // prompt falls back to the agnostic dimension list.
    try {
      stack = await detectProjectStack(projectDir);
    } catch { /* stack detect is best-effort */ }
    // Sonar findings — KJC-TSK-0361. Always best-effort + opt-out via
    // noSonar (CLI --no-sonar). When sonar is reachable we read the open
    // issues + quality gate to give the LLM deterministic findings with
    // rule IDs and line numbers; the section is omitted when sonar is
    // down or disabled.
    if (!noSonar) {
      try {
        sonarFindings = await collectSonarFindings(this.config, this.logger);
      } catch { /* sonar fetch is best-effort */ }
    }
    // WebPerf input — KJC-TSK-0360. Pure: static-hints for frontend
    // projects, optional CWV verdict when config carries a previous
    // measurement. No network/spawn from the audit; live CWV collection
    // is the future `kj webperf` command's job.
    let webperf = null;
    try {
      webperf = collectWebPerfInput(stack, this.config);
    } catch { /* webperf input is best-effort */ }

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const prompt = buildAuditPrompt({ task, instructions: this.instructions, dimensions, context, basalCost, growthDelta, stack, sonarFindings, webperf });
    const runArgs = { prompt, role: "audit" };
    if (onOutput) runArgs.onOutput = onOutput;
    const startedAt = Date.now();
    const result = await agent.runTask(runArgs);
    const durationMs = Date.now() - startedAt;

    // KJC-TSK-0363 — extract usage fields the agent SPREADS at the
    // top level of its result (tokens_in, tokens_out, cost_usd, model)
    // and consolidate them under a single `usage` object. Pre-patch we
    // forwarded `result.usage` which was always undefined because no
    // agent uses that key. Providers without usage telemetry (gemini,
    // aider, opencode) get an `available:false` marker so the consumer
    // can render "usage data not available" instead of zeros.
    const usage = extractUsage(result, { provider, durationMs });

    if (!result.ok) {
      return { ok: false, result: { error: result.error || result.output || "Audit failed", provider }, summary: `Audit failed: ${result.error || "unknown error"}`, usage };
    }

    try {
      const parsed = parseAuditOutput(result.output);
      if (!parsed) {
        return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage };
      }
      if (basalCost) { try { await saveAuditSnapshot(projectDir, basalCost); } catch { /* best-effort */ } }

      return {
        ok: true,
        result: {
          summary: parsed.summary, dimensions: parsed.dimensions,
          topRecommendations: parsed.topRecommendations,
          textSummary: parsed.textSummary || undefined,
          basalCost: basalCost || undefined, growthDelta: growthDelta || undefined,
          stack: stack || undefined,
          sonarFindings: sonarFindings?.available ? sonarFindings : undefined,
          webperf: webperf?.available ? webperf : undefined,
          provider
        },
        summary: buildSummary(parsed),
        usage
      };
    } catch {
      return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage };
    }
  }
}

/**
 * Consolidate the usage telemetry the agent spreads across its top-level
 * result fields. Returns a single object so consumers (CLI formatter,
 * report-file writer, MCP) don't need to know about the spread shape.
 *
 * @param {object} result - raw agent.runTask() return
 * @param {{provider: string, durationMs: number}} ctx
 * @returns {{available: boolean, provider: string, model?: string, tokens_in?: number, tokens_out?: number, total_tokens?: number, cost_usd?: number, durationMs: number, reason?: string}}
 */
function extractUsage(result, { provider, durationMs }) {
  if (!result || typeof result !== "object") {
    return { available: false, provider, durationMs, reason: "no agent result" };
  }
  const tokens_in = Number.isFinite(result.tokens_in) ? result.tokens_in : null;
  const tokens_out = Number.isFinite(result.tokens_out) ? result.tokens_out : null;
  if (tokens_in === null && tokens_out === null) {
    return { available: false, provider, model: result.model, durationMs, reason: `provider "${provider}" did not report token usage` };
  }
  return {
    available: true,
    provider,
    model: result.model,
    tokens_in: tokens_in ?? 0,
    tokens_out: tokens_out ?? 0,
    total_tokens: (tokens_in ?? 0) + (tokens_out ?? 0),
    cost_usd: typeof result.cost_usd === "number" ? result.cost_usd : null,
    durationMs,
  };
}
