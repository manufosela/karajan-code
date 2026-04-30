import path from "node:path";
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildAuditPrompt, parseAuditOutput, AUDIT_DIMENSIONS } from "../prompts/audit.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { runAgentReadiness, formatAgentReadinessReport } from "../audit/agent-readiness.js";

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

export async function auditCommand({ task, config, logger, dimensions, json, agentReadiness, path: pathArg }) {
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
    const auditRole = resolveRole(config, "audit");
    await assertAgentsAvailable([auditRole.provider]);
    logger.info(`Audit (${auditRole.provider}) starting...`);
    runLog.logText(`[audit] provider=${auditRole.provider} dimensions=${dimensions || "all"}`);

    const agent = createAgent(auditRole.provider, config, logger);
    const dimList = dimensions && dimensions !== "all"
      ? dimensions.split(",").map(d => d.trim().toLowerCase()).map(d => d === "quality" ? "codeQuality" : d).filter(d => AUDIT_DIMENSIONS.includes(d))
      : null;

    const prompt = buildAuditPrompt({ task: task || "Analyze the full codebase", dimensions: dimList });
    const progress = createCliProgressReporter({ role: "auditor" });
    let result;
    try {
      result = await agent.runTask({ prompt, onOutput: progress.onOutput, role: "audit" });
      progress.finish(result.ok ? "done" : "failed");
    } catch (err) { progress.finish("failed"); throw err; }

    if (!result.ok) {
      throw new Error(result.error || result.output || "Audit failed");
    }

    const parsed = parseAuditOutput(result.output);
    if (parsed?.summary) {
      runLog.logText(`[audit] findings=${parsed.summary.totalFindings} (critical=${parsed.summary.critical}, high=${parsed.summary.high})`);
    }

    if (json) {
      console.log(JSON.stringify(parsed || result.output, null, 2));
      return { ok: true };
    }

    if (parsed?.summary) {
      console.log(formatAudit(parsed));
    } else {
      console.log(result.output);
    }
    logger.info("Audit completed.");
    return { ok: true };
  });
}
