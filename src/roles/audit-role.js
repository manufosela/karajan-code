import { AgentRole } from "./agent-role.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { measureBasalCost, loadPreviousAudit, saveAuditSnapshot, computeGrowthDelta } from "../audit/basal-cost.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { collectSonarFindings } from "../audit/sonar-findings.js";
import { collectWebPerfInput } from "../audit/webperf-input.js";
import { collectOsvFindings } from "../audit/osv-findings.js";
import { collectSemgrepFindings } from "../audit/semgrep-findings.js";
import { collectInfraFindings } from "../audit/infra-findings.js";
import { collectCircularDeps } from "../audit/circular-deps.js";
import { collectDeadExports } from "../audit/dead-exports.js";
import { collectInjectionFindings } from "../audit/injection-findings.js";
import { collectAiSlop } from "../audit/ai-slop-findings.js";

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

  /**
   * Run the deterministic side of an audit — basalCost, stack detection,
   * Sonar issues, WebPerf input — without invoking the LLM. Cheap (no
   * tokens, no API call). KJC-TSK-0364 splits the original execute() into
   * this collector + executeWithDeterministic() so the CLI can show
   * deterministic findings first and ask the user before paying for the
   * LLM phase.
   *
   * @param {object|string} input - same shape execute() accepts
   * @returns {Promise<object>} deterministic context (the same data
   *   execute() would gather internally)
   */
  async collectDeterministic(input) {
    // KJC-TSK-0695: securityOnly = the focused pass an agent self-invokes
    // when a task touches sensitive surface. Only the security collectors
    // run (sonar, osv, semgrep, injection) — zero tokens, fast.
    const securityOnly = typeof input === "object" ? Boolean(input?.securityOnly) : false;
    const noSonar = typeof input === "object" ? Boolean(input?.noSonar) : false;
    const noOsv = typeof input === "object" ? Boolean(input?.noOsv) : false;
    const noSemgrep = typeof input === "object" ? Boolean(input?.noSemgrep) : false;
    const noMadge = (typeof input === "object" ? Boolean(input?.noMadge) : false) || securityOnly;
    const noKnip = (typeof input === "object" ? Boolean(input?.noKnip) : false) || securityOnly;
    const noInjectionScan = typeof input === "object" ? Boolean(input?.noInjectionScan) : false;
    const noInfraScan = typeof input === "object" ? Boolean(input?.noInfraScan) : false;
    const noAiSlop = (typeof input === "object" ? Boolean(input?.noAiSlop) : false) || securityOnly;
    const projectDir = this.config?.projectDir || process.cwd();
    let basalCost = null;
    let growthDelta = null;
    let stack = null;
    let sonarFindings = null;
    let webperf = null;
    let osvFindings = null;
    let semgrepFindings = null;
    let circularDeps = null;
    let deadExports = null;
    let injectionFindings = null;
    let infraFindings = null;
    let aiSlop = null;
    if (!securityOnly) {
      try {
        basalCost = await measureBasalCost(projectDir);
        const previous = await loadPreviousAudit(projectDir);
        growthDelta = computeGrowthDelta(basalCost, previous);
      } catch { /* basal cost is best-effort */ }
    }
    try {
      stack = await detectProjectStack(projectDir);
    } catch { /* stack detect is best-effort */ }
    if (!noSonar) {
      try {
        sonarFindings = await collectSonarFindings(this.config, this.logger);
      } catch { /* sonar fetch is best-effort */ }
    }
    if (!securityOnly) {
      try {
        webperf = collectWebPerfInput(stack, this.config);
      } catch { /* webperf input is best-effort */ }
    }
    // OSV vulnerabilities — KJC-TSK-0365. Best-effort: missing
    // osv-scanner binary returns available:false and the audit
    // continues without the section.
    if (!noOsv) {
      try {
        osvFindings = await collectOsvFindings(projectDir, this.logger);
      } catch { /* osv-scanner is best-effort */ }
    }
    // Semgrep SAST — KJC-TSK-0366. Best-effort: missing semgrep binary
    // returns available:false and the audit continues without the section.
    if (!noSemgrep) {
      try {
        semgrepFindings = await collectSemgrepFindings(projectDir, this.logger);
      } catch { /* semgrep is best-effort */ }
    }
    // Madge circular-import deps — KJC-TSK v2.17. Stack-aware: skipped for
    // non-JS/TS projects. Best-effort: any failure returns available:false
    // and the audit continues without the section.
    if (!noMadge) {
      try {
        circularDeps = await collectCircularDeps(projectDir, stack, this.config, this.logger);
      } catch { /* madge is best-effort */ }
    }
    // Knip dead-exports — KJC-TSK v2.17. Stack-aware, JS/TS only, needs
    // package.json. Best-effort: any failure returns available:false and
    // the audit continues without the section.
    if (!noKnip) {
      try {
        deadExports = await collectDeadExports(projectDir, stack, this.config, this.logger);
        // AC8 (KJC-TSK-0794): the report leads with the derivative — hand the
        // block its previous measurement, if one was ever recorded.
        if (deadExports?.available) {
          const prev = await loadPreviousAudit(projectDir);
          deadExports.previous = prev?.knipDeadExports ? { ...prev.knipDeadExports, timestamp: prev.timestamp || null } : null;
        }
      } catch { /* knip is best-effort */ }
    }
    if (!noInjectionScan) {
      try {
        injectionFindings = await collectInjectionFindings(projectDir, this.logger);
      } catch { /* injection scan is best-effort (KJC-TSK-0498) */ }
    }
    // Checkov infra misconfigs — INF-C (KJC-TSK-0760). Security surface, so
    // it ALSO runs in securityOnly. Best-effort: no infra markers or missing
    // checkov return available:false declaring why.
    if (!noInfraScan) {
      try {
        infraFindings = await collectInfraFindings(projectDir, this.logger);
      } catch { /* checkov is best-effort */ }
    }
    // AI-slop tells (KJC-TSK-0503). Deterministic, offline, regex-based.
    // Local equivalent of Deslopify-style review. Best-effort.
    if (!noAiSlop) {
      try {
        aiSlop = await collectAiSlop(projectDir);
      } catch { /* ai-slop scan is best-effort */ }
    }
    return { projectDir, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports, injectionFindings, infraFindings, aiSlop };
  }

  /**
   * Run the LLM phase of an audit using a pre-collected deterministic
   * context. KJC-TSK-0364: separated from execute() so the CLI can run
   * collectDeterministic() first, show findings, prompt, and only then
   * call this if the user wants to spend tokens.
   */
  async executeWithDeterministic(input, deterministicCtx) {
    const task = typeof input === "string" ? input : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;
    const rawDimensions = typeof input === "object" ? input?.dimensions || null : null;
    const context = typeof input === "object" ? input?.context || null : null;
    const dimensions = typeof rawDimensions === "string" ? parseDimensions(rawDimensions) : rawDimensions;

    const { projectDir, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports } = deterministicCtx;

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const prompt = buildAuditPrompt({ task, instructions: this.instructions, dimensions, context, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports });
    const runArgs = { prompt, role: "audit" };
    if (onOutput) runArgs.onOutput = onOutput;
    const startedAt = Date.now();
    const result = await agent.runTask(runArgs);
    const durationMs = Date.now() - startedAt;

    const usage = extractUsage(result, { provider, durationMs });

    if (!result.ok) {
      return { ok: false, result: { error: result.error || result.output || "Audit failed", provider }, summary: `Audit failed: ${result.error || "unknown error"}`, usage };
    }

    try {
      const parsed = parseAuditOutput(result.output);
      if (!parsed) {
        return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage };
      }
      if (basalCost) {
        const knipDeadExports = deadExports?.available ? { exports: (deadExports.exports || []).length, files: (deadExports.files || []).length } : null;
        try { await saveAuditSnapshot(projectDir, { ...basalCost, knipDeadExports }); } catch { /* best-effort */ }
      }

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
          osvFindings: osvFindings?.available ? osvFindings : undefined,
          semgrepFindings: semgrepFindings?.available ? semgrepFindings : undefined,
          circularDeps: circularDeps?.available ? circularDeps : undefined,
          deadExports: deadExports?.available ? deadExports : undefined,
          provider
        },
        summary: buildSummary(parsed),
        usage
      };
    } catch {
      return { ok: true, result: { raw: result.output, provider }, summary: "Audit complete (unstructured output)", usage };
    }
  }

  /**
   * Convenience: run both phases in one call. Identical to the previous
   * (single-phase) execute() so MCP and pipeline callers don't change.
   */
  async execute(input) {
    const deterministicCtx = await this.collectDeterministic(input);
    return this.executeWithDeterministic(input, deterministicCtx);
  }
}

/**
 * Consolidate the usage telemetry the agent spreads across its top-level
 * result fields. Returns a single object so consumers (CLI formatter,
 * report-file writer, MCP) don't need to know about the spread shape.
 *
 * Consumed by tests via vi.importActual (knip blind spot) — keep exported.
 * @public
 * @param {object} result - raw agent.runTask() return
 * @param {{provider: string, durationMs: number}} ctx
 * @returns {{available: boolean, provider: string, model?: string, tokens_in?: number, tokens_out?: number, cached_tokens?: number, total_tokens?: number, cost_usd?: number, durationMs: number, reason?: string}}
 */
export function extractUsage(result, { provider, durationMs }) {
  if (!result || typeof result !== "object") {
    return { available: false, provider, durationMs, reason: "no agent result" };
  }
  const tokens_in = Number.isFinite(result.tokens_in) ? result.tokens_in : null;
  const tokens_out = Number.isFinite(result.tokens_out) ? result.tokens_out : null;
  if (tokens_in === null && tokens_out === null) {
    return { available: false, provider, model: result.model, durationMs, reason: `provider "${provider}" did not report token usage` };
  }
  // KJC-BUG-0085: cached_tokens must survive this consolidation — the
  // budget chain (computeUsage → BudgetTracker → summary.md Cache hits →
  // telemetry) reads it from `usage` and the audit is the most expensive
  // role of the session.
  const cached_tokens = Number.isFinite(result.cached_tokens) ? result.cached_tokens : 0;
  return {
    available: true,
    provider,
    model: result.model,
    tokens_in: tokens_in ?? 0,
    tokens_out: tokens_out ?? 0,
    cached_tokens,
    total_tokens: (tokens_in ?? 0) + (tokens_out ?? 0),
    cost_usd: typeof result.cost_usd === "number" ? result.cost_usd : null,
    durationMs,
  };
}
