import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { AuditRole } from "../roles/audit-role.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { runAgentReadiness, formatAgentReadinessReport } from "../audit/agent-readiness.js";

const execFileAsync = promisify(execFile);

function formatFindings(findings) {
  const lines = [];
  for (const f of findings) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
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
  testing: "Testing"
};

function formatAudit(parsed) {
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
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
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

function describeInvocation({ task, dimensions, noSonar, json }) {
  const parts = ["kj audit"];
  if (task && task !== "Analyze the full codebase") parts.push(JSON.stringify(task));
  if (dimensions && dimensions !== "all") parts.push(`--dimensions=${dimensions}`);
  if (noSonar) parts.push("--no-sonar");
  if (json) parts.push("--json");
  return parts.join(" ");
}

export async function auditCommand({ task, config, logger, dimensions, json, agentReadiness, path: pathArg, noSonar = false, reportFile = null }) {
  // --agent-readiness is a STANDALONE, deterministic, LLM-free audit
  // dimension. It scores any third-party repo for AI-agent readability
  // (llms.txt presence, page token budgets, robots allowlist, etc.).
  // Per addyosmani/agentic-seo. Issue #542.
  if (agentReadiness) {
    const rootDir = path.resolve(pathArg || config?.projectDir || process.cwd());
    logger.info(`Auditing agent-readiness of ${rootDir}`);
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
    await assertAgentsAvailable([auditRoleConfig.provider]);
    logger.info(`Audit (${auditRoleConfig.provider}) starting...`);
    runLog.logText(`[audit] provider=${auditRoleConfig.provider} dimensions=${dimensions || "all"}`);

    // Path to audit output goes through AuditRole — same code path as MCP
    // (kj_audit) and the orchestrator pipeline. Pre-KJC-TSK-0357 this CLI
    // re-implemented createAgent + buildAuditPrompt + parseAuditOutput
    // inline, which silently dropped the deterministic basalCost /
    // growthDelta inputs that AuditRole.execute() collects. The result was
    // a CLI prompt that didn't tell the LLM about deadExports, unused
    // dependencies, or growth since the last audit.
    const role = new AuditRole({ config, logger });
    const progress = createCliProgressReporter({ role: "auditor" });
    let roleResult;
    try {
      roleResult = await role.execute({
        task: task || "Analyze the full codebase",
        dimensions: dimensions || null,
        onOutput: progress.onOutput,
        noSonar,
      });
      progress.finish(roleResult.ok ? "done" : "failed");
    } catch (err) { progress.finish("failed"); throw err; }

    if (!roleResult.ok) {
      const err = roleResult.result?.error || "Audit failed";
      throw new Error(err);
    }

    const parsed = roleResult.result;
    if (parsed?.summary?.overallHealth) {
      runLog.logText(`[audit] findings=${parsed.summary.totalFindings} (critical=${parsed.summary.critical}, high=${parsed.summary.high})`);
    }

    // Resolve write target BEFORE printing — if the user pointed at a
    // path that can't be created we want to fail fast, not after the LLM
    // has already printed everything to stdout.
    const reportPath = await resolveReportFilePath(reportFile, json);

    let stdoutContent;
    if (json) {
      stdoutContent = JSON.stringify(parsed || roleResult, null, 2);
    } else if (parsed?.summary?.overallHealth) {
      stdoutContent = formatAudit(parsed);
    } else if (parsed?.raw) {
      stdoutContent = parsed.raw;
    } else {
      stdoutContent = roleResult.summary || "Audit complete.";
    }
    console.log(stdoutContent);

    if (reportPath) {
      let payload;
      if (reportPath.endsWith(".json")) {
        payload = JSON.stringify(parsed || roleResult, null, 2);
      } else {
        const header = await buildReportHeader(config?.projectDir, describeInvocation({ task, dimensions, noSonar, json }));
        payload = header + stdoutContent + "\n";
      }
      await fs.writeFile(reportPath, payload, "utf8");
      runLog.logText(`[audit] report written → ${reportPath}`);
      logger.info(`Audit report written: ${reportPath}`);
    }

    logger.info("Audit completed.");
    return { ok: true, reportPath: reportPath || undefined };
  });
}

// Exposed for tests — kept module-private otherwise.
export { formatAudit, AUDIT_DIMENSIONS };
