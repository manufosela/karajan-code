import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AgentRole } from "./agent-role.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";
import { buildRoleFallbackChain } from "../brain/role-fallback-chain.js";
import { ONE_SHOT_POLICY } from "../brain/one-shot-policy.js";
import { securityAuditMarkerPath } from "../steward/invariants.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { measureBasalCost, loadPreviousAudit, saveAuditSnapshot, computeGrowthDelta } from "../audit/basal-cost.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { collectSonarFindings } from "../audit/sonar-findings.js";
import { collectWebPerfInput } from "../audit/webperf-input.js";
import { collectOsvFindings } from "../audit/osv-findings.js";
import { collectSemgrepFindings } from "../audit/semgrep-findings.js";
import { collectInfraFindings } from "../audit/infra-findings.js";
import { collectNpmSignatures } from "../audit/npm-signatures.js";
import { collectCircularDeps } from "../audit/circular-deps.js";
import { collectDeadExports } from "../audit/dead-exports.js";
import { collectInjectionFindings } from "../audit/injection-findings.js";
import { collectAiSlop } from "../audit/ai-slop-findings.js";
import { collectEnvKeyFindings } from "../audit/env-key-findings.js";

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

/** A deterministic collector's result, or null when it fails: every section is best-effort. */
async function bestEffort(collect) {
  try { return await collect(); } catch { return null; }
}

/** Basal cost and its growth against the last audit; a failure on the way leaves what was measured. */
async function basalWithGrowth(projectDir) {
  let basalCost = null;
  let growthDelta = null;
  try {
    basalCost = await measureBasalCost(projectDir);
    const previous = await loadPreviousAudit(projectDir);
    growthDelta = computeGrowthDelta(basalCost, previous);
  } catch { /* basal cost is best-effort */ }
  return { basalCost, growthDelta };
}

/**
 * Knip dead-exports — KJC-TSK v2.17. Stack-aware, JS/TS only, needs
 * package.json. Best-effort: any failure returns available:false and
 * the audit continues without the section.
 * AC8 (KJC-TSK-0794): the report leads with the derivative — hand the
 * block its previous measurement, if one was ever recorded.
 */
async function deadExportsWithPrevious(projectDir, stack, config, logger) {
  const deadExports = await collectDeadExports(projectDir, stack, config, logger);
  if (deadExports?.available) {
    try {
      const prev = await loadPreviousAudit(projectDir);
      deadExports.previous = prev?.knipDeadExports ? { ...prev.knipDeadExports, timestamp: prev.timestamp || null } : null;
    } catch { /* the findings stand without their previous measurement */ }
  }
  return deadExports;
}

/**
 * STW-A (KJC-TSK-0789 AC5): record that the security surface was looked
 * at, so the Steward can age it — GREBLA went 79 days with "never".
 */
function recordSecurityAudit(projectDir, securityOnly) {
  try {
    mkdirSync(dirname(securityAuditMarkerPath(projectDir)), { recursive: true });
    writeFileSync(securityAuditMarkerPath(projectDir), JSON.stringify({ at: new Date().toISOString(), mode: securityOnly ? "security" : "full" }));
  } catch { /* recording is best-effort — the audit itself already ran */ }
}

/** The LLM phase's input, from a task string or the options object. */
function auditInput(input, fallbackTask) {
  if (typeof input === "string") return { task: input, onOutput: null, dimensions: null, context: null };
  const rawDimensions = input?.dimensions || null;
  return {
    task: input?.task || fallbackTask,
    onOutput: input?.onOutput || null,
    dimensions: typeof rawDimensions === "string" ? parseDimensions(rawDimensions) : rawDimensions,
    context: input?.context || null,
  };
}

const ifAvailable = (section) => (section?.available ? section : undefined);

/** The structured result: the parsed audit plus every deterministic section that ran. */
function structuredResult(parsed, ctx, provider) {
  const { basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports, envKeys } = ctx;
  return {
    summary: parsed.summary, dimensions: parsed.dimensions,
    topRecommendations: parsed.topRecommendations,
    textSummary: parsed.textSummary || undefined,
    basalCost: basalCost || undefined, growthDelta: growthDelta || undefined,
    stack: stack || undefined,
    sonarFindings: ifAvailable(sonarFindings),
    webperf: ifAvailable(webperf),
    osvFindings: ifAvailable(osvFindings),
    semgrepFindings: ifAvailable(semgrepFindings),
    circularDeps: ifAvailable(circularDeps),
    deadExports: ifAvailable(deadExports),
    envKeys: ifAvailable(envKeys),
    provider,
  };
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
    const opts = (typeof input === "object" && input) || {};
    // KJC-TSK-0695: securityOnly = the focused pass an agent self-invokes
    // when a task touches sensitive surface. Only the security collectors
    // run (sonar, osv, semgrep, injection) — zero tokens, fast.
    const securityOnly = Boolean(opts.securityOnly);
    const skip = (flag) => Boolean(opts[flag]);
    const projectDir = this.config?.projectDir || process.cwd();
    const { config, logger } = this;
    // KJC-TSK-1257: every collector is best-effort — a failure leaves its section out (null).
    const { basalCost, growthDelta } = securityOnly ? { basalCost: null, growthDelta: null } : await basalWithGrowth(projectDir);
    const stack = await bestEffort(() => detectProjectStack(projectDir));
    const sonarFindings = skip("noSonar") ? null : await bestEffort(() => collectSonarFindings(config, logger));
    const webperf = securityOnly ? null : await bestEffort(() => collectWebPerfInput(stack, config));
    // OSV vulnerabilities — KJC-TSK-0365. Best-effort: missing
    // osv-scanner binary returns available:false and the audit
    // continues without the section.
    const osvFindings = skip("noOsv") ? null : await bestEffort(() => collectOsvFindings(projectDir, logger));
    // Semgrep SAST — KJC-TSK-0366. Best-effort: missing semgrep binary
    // returns available:false and the audit continues without the section.
    const semgrepFindings = skip("noSemgrep") ? null : await bestEffort(() => collectSemgrepFindings(projectDir, logger));
    // Madge circular-import deps — KJC-TSK v2.17. Stack-aware: skipped for
    // non-JS/TS projects. Best-effort: any failure returns available:false
    // and the audit continues without the section.
    const circularDeps = skip("noMadge") || securityOnly ? null : await bestEffort(() => collectCircularDeps(projectDir, stack, config, logger));
    const deadExports = skip("noKnip") || securityOnly ? null : await bestEffort(() => deadExportsWithPrevious(projectDir, stack, config, logger));
    const injectionFindings = skip("noInjectionScan") ? null : await bestEffort(() => collectInjectionFindings(projectDir, logger));
    // Checkov infra misconfigs — INF-C (KJC-TSK-0760). Security surface, so
    // it ALSO runs in securityOnly. Best-effort: no infra markers or missing
    // checkov return available:false declaring why.
    const infraFindings = skip("noInfraScan") ? null : await bestEffort(() => collectInfraFindings(projectDir, logger));
    // KJC-TSK-1253: npm registry signatures and provenance. Supply-chain security, so it
    // also runs in securityOnly; the collector says when it does not apply or cannot run.
    const npmSignatures = skip("noNpmSignatures") ? null : await bestEffort(() => collectNpmSignatures(projectDir, logger));
    // AI-slop tells (KJC-TSK-0503). Deterministic, offline, regex-based.
    // Local equivalent of Deslopify-style review. Best-effort.
    const aiSlop = skip("noAiSlop") || securityOnly ? null : await bestEffort(() => collectAiSlop(projectDir));
    // KJC-TSK-0845: one key, two resolution rules = a migration left half-way
    // (KJ_HOME → KARAJAN_HOME). Deterministic, offline, best-effort.
    const envKeys = securityOnly ? null : await bestEffort(() => collectEnvKeyFindings(projectDir));
    recordSecurityAudit(projectDir, securityOnly);
    return { projectDir, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports, injectionFindings, infraFindings, npmSignatures, aiSlop, envKeys };
  }

  /**
   * Run the LLM phase of an audit using a pre-collected deterministic
   * context. KJC-TSK-0364: separated from execute() so the CLI can run
   * collectDeterministic() first, show findings, prompt, and only then
   * call this if the user wants to spend tokens.
   */
  async executeWithDeterministic(input, deterministicCtx) {
    const { task, onOutput, dimensions, context } = auditInput(input, this.context?.task || "");
    const { projectDir, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports } = deterministicCtx;

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const prompt = buildAuditPrompt({ task, instructions: this.instructions, dimensions, context, basalCost, growthDelta, stack, sonarFindings, webperf, osvFindings, semgrepFindings, circularDeps, deadExports });
    const runArgs = { prompt, role: "audit" };
    if (onOutput) runArgs.onOutput = onOutput;
    const startedAt = Date.now();
    // KJC-BUG-0194: this used to call agent.runTask() directly, which made
    // audit the ONE role that bypassed the brain. No classification (so an MCP
    // caller saw a quota wall as category "unknown") and no declared chain
    // (so roles.audit.fallback was ignored even after KJC-TSK-0859 wired it,
    // because the wiring lives in AgentRole.execute and audit overrides it).
    // The one-shot policy matters here: `kj audit` must take the next
    // candidate at once rather than hibernate for hours inside a command.
    const result = await withBrainRecovery({
      agent: { runTask: (args) => agent.runTask(args), provider, model: this.config?.roles?.audit?.model ?? null },
      taskArgs: runArgs,
      role: "audit",
      provider,
      logger: this.logger,
      emitter: this.emitter,
      policy: ONE_SHOT_POLICY,
      fallback: buildRoleFallbackChain({ config: this.config, role: "audit", createAgentFn: this._createAgent, logger: this.logger }),
    });
    const durationMs = Date.now() - startedAt;

    const usage = extractUsage(result, { provider, durationMs });

    if (!result.ok) {
      // The classification and the itinerary travel with the failure, so a
      // caller (CLI or MCP) can say WHY it stopped and what was tried.
      return {
        ok: false,
        result: { error: result.error || result.output || "Audit failed", provider, recovery: result.recovery || null, tried: result.tried || null },
        summary: `Audit failed: ${result.recovery?.class ? `${result.recovery.class} — ` : ""}${result.error || "unknown error"}`,
        usage,
      };
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

      return { ok: true, result: structuredResult(parsed, deterministicCtx, provider), summary: buildSummary(parsed), usage };
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
