import path from "node:path";
import fs from "node:fs/promises";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertAgentsAvailable, filterAvailableAgents } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { AuditRole } from "../roles/audit-role.js";
import { buildAuditFallbackCandidates, runAuditWithFallback } from "../audit/audit-fallback.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { runAgentReadiness, formatAgentReadinessReport } from "../audit/agent-readiness.js";
import { formatDeterministicSummary } from "../audit/deterministic-summary.js";
import { runHarnessSection, formatHarnessSection, harnessSummaryForJson } from "../audit/harness-section.js";
import { persistAuditRun, openAuditHistoryDb, getLatestPreviousRun, getRecentScores } from "../audit/audit-history.js";
import { computeHistoryDiff, formatHistoryDiff, formatTrendSparkline } from "../audit/audit-history-display.js";

const execFileAsync = promisify(execFile);

/**
 * Prompt the user (TTY only) to decide whether to continue with the LLM
 * phase after deterministic findings have been printed. KJC-TSK-0364.
 *
 * @returns {Promise<boolean>} true to continue with LLM, false to skip
 */
function promptContinueWithLlm({ promptFn = null } = {}) {
  if (typeof promptFn === "function") return promptFn();
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(true); return; } // CI / piped input → continue
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Continue with LLM analysis? [y/N] ", (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || "").trim()));
    });
  });
}

function formatFindings(findings) {
  const lines = [];
  for (const f of findings) {
    const lineSuffix = f.line ? `:${f.line}` : "";
    const loc = f.file ? `${f.file}${lineSuffix}` : "";
    const rule = f.rule ? ` [${f.rule}]` : "";
    lines.push(`  - [${f.severity.toUpperCase()}] ${loc}${rule}`);
    lines.push(`    ${f.description}`);
    if (f.recommendation) lines.push(`    Fix: ${f.recommendation}`);
  }
  return lines;
}

function formatDimension(name, dim) {
  const lines = [];
  lines.push(`### ${name} — Score: ${dim.score}`);
  if (dim.findings.length === 0) {
    lines.push("  No issues found.");
  } else {
    lines.push(...formatFindings(dim.findings));
  }
  lines.push("");
  return lines;
}

function formatRecommendations(recs) {
  const lines = ["## Top Recommendations", ""];
  for (const r of recs) {
    lines.push(`${r.priority}. [${r.dimension}] ${r.action} (impact: ${r.impact}, effort: ${r.effort})`);
  }
  lines.push("");
  return lines;
}

const DIMENSION_LABELS = {
  security: "Security",
  codeQuality: "Code Quality",
  performance: "Performance",
  architecture: "Architecture",
  testing: "Testing",
  accessibility: "Accessibility (WCAG 2.x)"
};

function formatAudit(parsed, usage = null) {
  const lines = [];
  lines.push("## Codebase Health Report");
  lines.push(`**Overall Health:** ${parsed.summary.overallHealth}`);
  lines.push(`**Total Findings:** ${parsed.summary.totalFindings} (${parsed.summary.critical} critical, ${parsed.summary.high} high, ${parsed.summary.medium} medium, ${parsed.summary.low} low)`);
  lines.push("");

  for (const dim of AUDIT_DIMENSIONS) {
    if (parsed.dimensions[dim]) {
      lines.push(...formatDimension(DIMENSION_LABELS[dim] || dim, parsed.dimensions[dim]));
    }
  }

  if (parsed.topRecommendations?.length) {
    lines.push(...formatRecommendations(parsed.topRecommendations));
  }

  if (parsed.textSummary) lines.push(`---\n${parsed.textSummary}`);

  const usageBlock = formatUsageSummary(usage);
  if (usageBlock) {
    lines.push("");
    lines.push(usageBlock);
  }

  return lines.join("\n");
}

/**
 * Format the LLM token + cost summary that closes every audit report.
 * KJC-TSK-0363: makes the LLM cost visible (was silently discarded
 * pre-patch — auditCommand never read roleResult.usage).
 *
 * @param {object|null} usage - shape produced by AuditRole's extractUsage
 * @returns {string|null} markdown block, or null when there's nothing useful to show
 */
function formatUsageSummary(usage) {
  if (!usage) return null;
  const lines = ["## LLM Usage"];
  const modelSuffix = usage.model ? ` (${usage.model})` : "";
  lines.push(`- Provider: ${usage.provider}${modelSuffix}`);
  if (typeof usage.durationMs === "number") {
    lines.push(`- Duration: ${(usage.durationMs / 1000).toFixed(1)}s`);
  }
  if (!usage.available) {
    lines.push(`- Tokens: usage data not available — ${usage.reason || "provider does not report it"}`);
    return lines.join("\n");
  }
  // Force en-US locale so the comma grouping is deterministic across CI
  // machines (Node's default Intl.NumberFormat depends on the runtime
  // locale; without this the rendering would look like "1234" on
  // locale-less Node and "1,234" on a US-locale workstation).
  const fmt = (n) => n.toLocaleString("en-US");
  lines.push(`- Tokens: ${fmt(usage.total_tokens)} total (${fmt(usage.tokens_in)} in, ${fmt(usage.tokens_out)} out)`);
  if (typeof usage.cached_tokens === "number" && usage.cached_tokens > 0) {
    lines.push(`- Cached tokens: ${fmt(usage.cached_tokens)} (prompt-cache hits)`);
  }
  if (typeof usage.cost_usd === "number") {
    lines.push(`- Estimated cost: $${usage.cost_usd.toFixed(4)} USD`);
  }
  return lines.join("\n");
}

/**
 * Resolve where to write the audit report on disk, given a flag value, an
 * env override, and the desired format. Returns null if no write target
 * was requested. Creates parent directories on demand.
 *
 * Resolution rules (KJC-TSK-0362):
 *   - flag undefined + no env → null (legacy behaviour, stdout only)
 *   - flag is a directory → write `audit-<ISO>.{md,json}` inside it
 *   - flag is a non-directory path → use it verbatim (extension drives format
 *     when --json/--md not explicit)
 *   - flag is undefined but env $KJ_AUDIT_REPORT_DIR is set → treat env as dir
 */
async function resolveReportFilePath(flagValue, isJson) {
  const envDir = process.env.KJ_AUDIT_REPORT_DIR;
  const target = flagValue || (envDir ? envDir : null);
  if (!target) return null;

  const ext = isJson ? "json" : "md";
  let stats = null;
  try { stats = await fs.stat(target); } catch { /* not a directory yet */ }
  const isDir = stats?.isDirectory() || target.endsWith(path.sep) || target === envDir;

  let resolved;
  if (isDir) {
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    resolved = path.resolve(target, `audit-${stamp}.${ext}`);
  } else {
    resolved = path.resolve(target);
  }

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * Build the markdown header that prefixes a persisted report — captures
 * timestamp + repo state + invocation flags so the file is reproducible.
 */
async function buildReportHeader(projectDir, invocation) {
  const lines = ["# Karajan Audit Report", ""];
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push(`- **Project:** ${projectDir || process.cwd()}`);

  // Best-effort git info — silent if outside a repo.
  try {
    const branch = (await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, timeout: 2000 })).stdout.trim();
    const commit = (await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectDir, timeout: 2000 })).stdout.trim();
    lines.push(`- **Branch:** ${branch}`);
    lines.push(`- **Commit:** ${commit}`);
  } catch { /* not a git repo or git missing */ }

  if (invocation) lines.push(`- **Invocation:** \`${invocation}\``);
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function composeHistoryBlock({ diffMd, trendMd }) {
  const parts = [];
  if (diffMd) parts.push(diffMd);
  if (trendMd) parts.push(trendMd);
  return parts.length ? `\n\n## Harness Score History\n${parts.join("\n\n")}` : "";
}

// KJC-TSK-0473 — Resolve diff vs previous run + optional trend sparkline.
// Errors silenced: history is a nice-to-have; a broken db must not break audit.
function loadAuditHistoryContext(projectDir, currentHarness, { showTrend = false } = {}) {
  let db;
  try {
    db = openAuditHistoryDb(projectDir);
    if (!db) return { diff: null, diffMd: "", trendMd: "" };
    const previous = currentHarness?.score != null ? getLatestPreviousRun(db, new Date().toISOString()) : null;
    const diff = currentHarness?.score != null ? computeHistoryDiff(currentHarness, previous) : null;
    const trendMd = showTrend ? formatTrendSparkline(getRecentScores(db, 10)) : "";
    return { diff, diffMd: formatHistoryDiff(diff), trendMd };
  } catch { return { diff: null, diffMd: "", trendMd: "" }; }
  finally { try { db?.close(); } catch { /* noop */ } }
}

function describeInvocation({ task, dimensions, noSonar, noOsv, noSemgrep, noHarness, noAiSlop, json, deterministicOnly, yes }) {
  const parts = ["kj audit"];
  if (task && task !== "Analyze the full codebase") parts.push(JSON.stringify(task));
  if (dimensions && dimensions !== "all") parts.push(`--dimensions=${dimensions}`);
  if (noSonar) parts.push("--no-sonar");
  if (noOsv) parts.push("--no-osv");
  if (noSemgrep) parts.push("--no-semgrep");
  if (noHarness) parts.push("--no-harness");
  if (noAiSlop) parts.push("--no-ai-slop");
  if (deterministicOnly) parts.push("--deterministic-only");
  if (yes) parts.push("--yes");
  if (json) parts.push("--json");
  return parts.join(" ");
}

export async function auditCommand({ task, config, logger, dimensions, json, agentReadiness, path: pathArg, noSonar = false, noOsv = false, noSemgrep = false, noHarness = false, noAiSlop = false, reportFile = null, deterministicOnly = false, yes = false, trend = false, promptFn = null, security = false }) {
  // KJC-TSK-0695: --security = the focused pass an agent self-invokes.
  // Deterministic by definition (zero tokens) and skips non-security stages.
  if (security) { deterministicOnly = true; noHarness = true; noAiSlop = true; }
  // --agent-readiness is a STANDALONE, deterministic, LLM-free audit
  // dimension. It scores any third-party repo for AI-agent readability
  // (llms.txt presence, page token budgets, robots allowlist, etc.).
  // Per addyosmani/agentic-seo. Issue #542.
  if (agentReadiness) {
    const rootDir = path.resolve(pathArg || config?.projectDir || process.cwd());
    // Suppress the info banner in --json mode so stdout stays a single
    // valid JSON document. Without this guard, `kj audit --agent-readiness
    // --json | jq` fails with a parse error because the logger writes
    // "Auditing agent-readiness of ..." to stdout BEFORE the JSON blob.
    if (!json) logger.info(`Auditing agent-readiness of ${rootDir}`);
    const report = runAgentReadiness(rootDir);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatAgentReadinessReport(report, rootDir));
    }
    // Exit code: 0 always (audit succeeded). The score is the signal.
    return;
  }

  return withCliRunLog("audit", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    const auditRoleConfig = resolveRole(config, "audit");
    // KJC-BUG-0094: proceed if any fallback candidate is installed; throw only when NONE are.
    const fallbackCandidates = buildAuditFallbackCandidates(config);
    const candidateProviders = [...new Set(fallbackCandidates.map((c) => c.provider))];
    const available = await filterAvailableAgents(candidateProviders);
    if (available.length === 0) await assertAgentsAvailable([auditRoleConfig.provider]);
    logger.info(`Audit (${auditRoleConfig.provider}) starting...`);
    runLog.logText(`[audit] provider=${auditRoleConfig.provider} dimensions=${dimensions || "all"} deterministicOnly=${deterministicOnly}`);

    // Two-phase audit (KJC-TSK-0364) — collect deterministic findings
    // first; show them; ask the user (when TTY + not --yes + not
    // --deterministic-only) whether to spend tokens on the LLM analysis.
    // CI / piped input / --yes / --deterministic-only never prompts.
    const role = new AuditRole({ config, logger });
    const roleInput = {
      task: task || "Analyze the full codebase",
      dimensions: dimensions || null,
      noSonar,
      noOsv,
      noSemgrep,
      noAiSlop,
      ...(security ? { securityOnly: true } : {}),
    };
    const deterministicCtx = await role.collectDeterministic(roleInput);
    const deterministicMd = formatDeterministicSummary(deterministicCtx);

    // KJC-TSK-0471 — Harness Scorecard (Docker one-shot, golden metric).
    // Runs after the deterministic phase, before the LLM. Auto-skipped on
    // --no-harness or if `runHarnessSection` surfaces an error (graceful
    // degradation: a missing Docker daemon must not break `kj audit`).
    let harnessSummary = null;
    if (!noHarness) {
      try {
        harnessSummary = await runHarnessSection({
          projectDir: config?.projectDir || process.cwd(),
          harnessConfig: config?.audit?.harness || null,
        });
        if (harnessSummary?.ok && !harnessSummary.skipped) {
          runLog.logText(`[audit] harness score=${harnessSummary.score}/100 grade=${harnessSummary.grade}`);
        }
      } catch (e) {
        harnessSummary = { ok: false, error: e?.message || String(e) };
        runLog.logText(`[audit] harness skipped: ${harnessSummary.error}`);
      }
    }
    const harnessMd = formatHarnessSection(harnessSummary);

    // --json suppresses the interactive flow regardless: it would mangle
    // a script's stdout. JSON consumers always get the full audit unless
    // they explicitly pass deterministicOnly.
    const reportPath = await resolveReportFilePath(reportFile, json);
    let runLlm = !deterministicOnly;
    if (runLlm && !json && !yes) {
      console.log(deterministicMd);
      console.log("");
      const ok = await promptContinueWithLlm({ promptFn });
      runLlm = ok;
      if (!ok) logger.info("LLM analysis skipped (deterministic-only mode).");
    }

    if (!runLlm) {
      // Deterministic-only path. Produce the report from what we already
      // have, persist it (md or json), and exit. Zero tokens spent.
      const harnessJson = harnessSummaryForJson(harnessSummary);
      const currentHarness = harnessSummary?.ok && !harnessSummary.skipped ? harnessSummary : null;
      const history = loadAuditHistoryContext(config?.projectDir || process.cwd(), currentHarness, { showTrend: trend });
      const historyMd = composeHistoryBlock(history);
      const stdoutContent = json
        ? JSON.stringify({ deterministic: deterministicCtx, harnessScore: harnessJson, harnessScoreDiff: history.diff, mode: "deterministic-only" }, null, 2)
        : (deterministicOnly ? `${deterministicMd}\n${harnessMd}${historyMd}` : `${harnessMd}${historyMd}`);
      if (json || deterministicOnly || harnessMd) console.log(stdoutContent);

      if (reportPath) {
        let payload;
        if (reportPath.endsWith(".json")) {
          payload = JSON.stringify({ deterministic: deterministicCtx, harnessScore: harnessJson, harnessScoreDiff: history.diff, mode: "deterministic-only" }, null, 2);
        } else {
          const header = await buildReportHeader(config?.projectDir, describeInvocation({ task, dimensions, noSonar, noOsv, noSemgrep, noHarness, noAiSlop, json, deterministicOnly, yes }));
          payload = `${header}${deterministicMd}\n${harnessMd}${historyMd}`;
        }
        await fs.writeFile(reportPath, payload, "utf8");
        runLog.logText(`[audit] report written (deterministic-only) → ${reportPath}`);
        logger.info(`Audit report written: ${reportPath}`);
      }
      persistAuditRun(config?.projectDir || process.cwd(), { runId: new Date().toISOString(), timestamp: new Date().toISOString(), gitSha: null, harness: harnessSummary?.ok && !harnessSummary.skipped ? harnessSummary : null, rawReportPath: reportPath });
      logger.info("Audit completed (deterministic-only).");
      return { ok: true, mode: "deterministic-only", reportPath: reportPath || undefined };
    }

    // Continue with the LLM phase using the already-collected context.
    const progress = createCliProgressReporter({ role: "auditor" });
    let roleResult;
    try {
      // KJC-BUG-0094: resilient fallback — if the configured provider/model
      // is down (e.g. an inherited model like "claude-fable-5" is offline),
      // degrade to the provider default, then to the next installed provider,
      // reusing the deterministic context so no static analysis is re-run.
      roleResult = await runAuditWithFallback({
        config, logger,
        roleInput: { ...roleInput, onOutput: progress.onOutput },
        deterministicCtx,
        available,
        candidates: fallbackCandidates,
        onFallback: (cand) => logger.warn(`Audit provider fallback → ${cand.provider}${cand.model ? ` (${cand.model})` : " (default model)"}`),
      });
      progress.finish(roleResult.ok ? "done" : "failed");
    } catch (err) { progress.finish("failed"); throw err; }

    if (!roleResult.ok) {
      const err = roleResult.result?.error || "Audit failed";
      throw new Error(err);
    }

    const parsed = roleResult.result;
    const usage = roleResult.usage;
    if (parsed?.summary?.overallHealth) {
      runLog.logText(`[audit] findings=${parsed.summary.totalFindings} (critical=${parsed.summary.critical}, high=${parsed.summary.high})`);
    }
    if (usage?.available) {
      runLog.logText(`[audit] usage tokens=${usage.total_tokens} cost=$${(usage.cost_usd ?? 0).toFixed(4)} duration=${(usage.durationMs / 1000).toFixed(1)}s`);
    }

    const harnessJson = harnessSummaryForJson(harnessSummary);
    const currentHarness = harnessSummary?.ok && !harnessSummary.skipped ? harnessSummary : null;
    const history = loadAuditHistoryContext(config?.projectDir || process.cwd(), currentHarness, { showTrend: trend });
    const historyMd = composeHistoryBlock(history);
    let stdoutContent;
    if (json) {
      const jsonPayload = parsed
        ? { ...parsed, harnessScore: harnessJson, harnessScoreDiff: history.diff, usage: usage || undefined }
        : { ...roleResult, harnessScore: harnessJson, harnessScoreDiff: history.diff, usage: usage || undefined };
      stdoutContent = JSON.stringify(jsonPayload, null, 2);
    } else if (parsed?.summary?.overallHealth) {
      stdoutContent = `${formatAudit(parsed, usage)}\n${harnessMd}${historyMd}`;
    } else if (parsed?.raw) {
      stdoutContent = parsed.raw + (usage ? `\n\n${formatUsageSummary(usage) || ""}` : "") + `\n${harnessMd}${historyMd}`;
    } else {
      stdoutContent = `${roleResult.summary || "Audit complete."}\n${harnessMd}${historyMd}`;
    }
    console.log(stdoutContent);

    if (reportPath) {
      let payload;
      if (reportPath.endsWith(".json")) {
        const jsonPayload = parsed
          ? { ...parsed, harnessScore: harnessJson, harnessScoreDiff: history.diff, usage: usage || undefined }
          : { ...roleResult, harnessScore: harnessJson, harnessScoreDiff: history.diff, usage: usage || undefined };
        payload = JSON.stringify(jsonPayload, null, 2);
      } else {
        const header = await buildReportHeader(config?.projectDir, describeInvocation({ task, dimensions, noSonar, noOsv, noSemgrep, noHarness, noAiSlop, json, deterministicOnly, yes }));
        payload = header + stdoutContent + "\n";
      }
      await fs.writeFile(reportPath, payload, "utf8");
      runLog.logText(`[audit] report written → ${reportPath}`);
      logger.info(`Audit report written: ${reportPath}`);
    }

    persistAuditRun(config?.projectDir || process.cwd(), { runId: new Date().toISOString(), timestamp: new Date().toISOString(), gitSha: null, harness: harnessSummary?.ok && !harnessSummary.skipped ? harnessSummary : null, rawReportPath: reportPath });
    logger.info("Audit completed.");
    return { ok: true, reportPath: reportPath || undefined };
  });
}

// Exposed for tests — kept module-private otherwise.
export { formatAudit, formatUsageSummary };
