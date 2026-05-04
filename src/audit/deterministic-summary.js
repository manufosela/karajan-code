/**
 * Deterministic-only summary formatter for `kj audit` two-phase mode
 * (KJC-TSK-0364). Renders the data AuditRole.collectDeterministic()
 * gathers — basalCost, growth delta, stack, Sonar findings, WebPerf —
 * as a self-contained markdown block the user can read BEFORE deciding
 * whether to spend tokens on the LLM analysis.
 *
 * Kept in src/audit/ (not src/commands/) so the same formatter can be
 * reused by future MCP tools and other entrypoints.
 */

import { groupIssuesBySeverity } from "./sonar-findings.js";
import { groupVulnerabilitiesBySeverity } from "./osv-findings.js";

const MAX_SAMPLE_DEAD_EXPORTS = 10;
const MAX_SAMPLE_SONAR_PER_SEVERITY = 5;
const MAX_SAMPLE_OSV_PER_SEVERITY = 5;

/**
 * @param {{basalCost?: object, growthDelta?: object, stack?: object, sonarFindings?: object, webperf?: object, osvFindings?: object}} ctx
 * @returns {string} markdown block
 */
export function formatDeterministicSummary(ctx) {
  const lines = ["## Deterministic Findings", ""];
  lines.push("These are the rule-based findings (no LLM). They cost zero tokens and are always factually accurate. The interactive prompt below asks if you want to extend this with an LLM analysis (which will cost tokens).");
  lines.push("");

  if (ctx.stack) lines.push(...formatStackBlock(ctx.stack));
  if (ctx.basalCost) lines.push(...formatBasalCostBlock(ctx.basalCost, ctx.growthDelta));
  if (ctx.sonarFindings) lines.push(...formatSonarBlock(ctx.sonarFindings));
  if (ctx.osvFindings) lines.push(...formatOsvBlock(ctx.osvFindings));
  if (ctx.webperf) lines.push(...formatWebperfBlock(ctx.webperf));

  return lines.join("\n");
}

function formatOsvBlock(osvFindings) {
  if (!osvFindings.available) {
    return ["### OSV Vulnerabilities", `- Status: not available — ${osvFindings.reason || "osv-scanner not installed"}`, ""];
  }
  const lines = ["### OSV Vulnerabilities (Dependencies)"];
  lines.push(`- Total open: ${osvFindings.total ?? 0}`);
  if ((osvFindings.total ?? 0) > 0) {
    const groups = groupVulnerabilitiesBySeverity(osvFindings.vulnerabilities || []);
    for (const [severity, vulns] of Object.entries(groups)) {
      if (vulns.length === 0) continue;
      lines.push(`  - ${severity} (${vulns.length}):`);
      for (const v of vulns.slice(0, MAX_SAMPLE_OSV_PER_SEVERITY)) {
        const where = v.package ? `${v.package}@${v.version || "?"}` : "(unknown)";
        const fixed = v.fixed ? ` → fixed in ${v.fixed}` : "";
        lines.push(`    - ${v.id} ${where}${fixed}`);
      }
      if (vulns.length > MAX_SAMPLE_OSV_PER_SEVERITY) {
        lines.push(`    - ... and ${vulns.length - MAX_SAMPLE_OSV_PER_SEVERITY} more in ${severity}`);
      }
    }
  }
  lines.push("");
  return lines;
}

function formatStackBlock(stack) {
  if (!stack || (!stack.frameworks?.length && !stack.language && !stack.isFrontend && !stack.isBackend)) return [];
  const lines = ["### Project Stack"];
  if (stack.language) lines.push(`- Language: ${stack.language}`);
  if (stack.frameworks?.length) lines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
  const tier = stack.isFullstack ? "fullstack (frontend + backend)"
    : stack.isFrontend ? "frontend-only"
    : stack.isBackend ? "backend-only"
    : "unknown";
  lines.push(`- Tier: ${tier}`);
  lines.push("");
  return lines;
}

function formatBasalCostBlock(basalCost, growthDelta) {
  const lines = ["### Basal Cost"];
  lines.push(`- Source: ${basalCost.totalLines} lines across ${basalCost.totalFiles} files`);
  const deps = basalCost.dependencies || {};
  if (deps.total) lines.push(`- Dependencies: ${deps.total} (${deps.dependencies} prod + ${deps.devDependencies} dev)`);

  const unused = basalCost.unusedDependencies?.unused;
  if (Array.isArray(unused) && unused.length > 0) {
    lines.push(`- Unused dependencies (${unused.length}): ${unused.join(", ")}`);
  }

  const dead = Array.isArray(basalCost.deadExports) ? basalCost.deadExports : [];
  if (dead.length > 0) {
    lines.push(`- Dead exports: ${dead.length}`);
    for (const de of dead.slice(0, MAX_SAMPLE_DEAD_EXPORTS)) {
      lines.push(`  - \`${de.name}\` in ${de.file}`);
    }
    if (dead.length > MAX_SAMPLE_DEAD_EXPORTS) {
      lines.push(`  - ... and ${dead.length - MAX_SAMPLE_DEAD_EXPORTS} more`);
    }
  } else {
    lines.push("- Dead exports: 0");
  }

  if (growthDelta) {
    lines.push("");
    lines.push("**Growth since last audit**");
    lines.push(`- Lines: ${growthDelta.lines >= 0 ? "+" : ""}${growthDelta.lines}`);
    lines.push(`- Files: ${growthDelta.files >= 0 ? "+" : ""}${growthDelta.files}`);
    lines.push(`- Dependencies: ${growthDelta.deps >= 0 ? "+" : ""}${growthDelta.deps}`);
    if (growthDelta.since) lines.push(`- Since: ${growthDelta.since}`);
  }
  lines.push("");
  return lines;
}

function formatSonarBlock(sonarFindings) {
  if (!sonarFindings.available) {
    return ["### SonarQube", `- Status: not available — ${sonarFindings.reason || "host unreachable"}`, ""];
  }
  const lines = ["### SonarQube"];
  if (sonarFindings.qualityGate?.status) lines.push(`- Quality gate: ${sonarFindings.qualityGate.status}`);
  lines.push(`- Open issues: ${sonarFindings.total ?? 0}`);
  if ((sonarFindings.total ?? 0) > 0) {
    const groups = groupIssuesBySeverity(sonarFindings.issues || []);
    for (const [severity, issues] of Object.entries(groups)) {
      if (issues.length === 0) continue;
      lines.push(`  - ${severity} (${issues.length}):`);
      for (const issue of issues.slice(0, MAX_SAMPLE_SONAR_PER_SEVERITY)) {
        const loc = issue.component ? `${issue.component}${issue.line ? `:${issue.line}` : ""}` : "";
        const rule = issue.rule ? ` [${issue.rule}]` : "";
        lines.push(`    - ${loc}${rule} ${issue.message || ""}`.trim());
      }
      if (issues.length > MAX_SAMPLE_SONAR_PER_SEVERITY) {
        lines.push(`    - ... and ${issues.length - MAX_SAMPLE_SONAR_PER_SEVERITY} more in ${severity}`);
      }
    }
  }
  lines.push("");
  return lines;
}

function formatWebperfBlock(webperf) {
  if (!webperf.available) {
    return ["### WebPerf", `- Status: not collected — ${webperf.reason || "no frontend signal"}`, ""];
  }
  const lines = ["### WebPerf"];
  if (webperf.mode === "cwv-result" && webperf.cwv) {
    lines.push(`- Mode: live CWV measurement`);
    if (webperf.url) lines.push(`- URL: ${webperf.url}`);
    lines.push(`- Verdict: ${webperf.cwv.pass ? "PASS" : "FAIL"}`);
    for (const [metric, score] of Object.entries(webperf.cwv.scores || {})) {
      lines.push(`  - ${metric.toUpperCase()}: ${score.value} (${score.rating})`);
    }
  } else {
    lines.push(`- Mode: static hints only (no live CWV measurement available)`);
    lines.push(`- LLM phase will scan source for bundle/lazy/img-opt patterns when activated`);
  }
  lines.push("");
  return lines;
}

/**
 * Detect whether the deterministic context found any signal worth showing.
 * If everything came back empty/unavailable, the CLI can skip the
 * "Continue with LLM?" prompt — there's nothing to compare against.
 */
export function deterministicContextHasFindings(ctx) {
  if (!ctx) return false;
  if (ctx.basalCost?.deadExports?.length > 0) return true;
  if (ctx.basalCost?.unusedDependencies?.unused?.length > 0) return true;
  if (ctx.sonarFindings?.available && (ctx.sonarFindings.total ?? 0) > 0) return true;
  if (ctx.sonarFindings?.qualityGate?.status === "ERROR") return true;
  if (ctx.osvFindings?.available && (ctx.osvFindings.total ?? 0) > 0) return true;
  if (ctx.growthDelta && (Math.abs(ctx.growthDelta.lines || 0) > 100 || Math.abs(ctx.growthDelta.deps || 0) > 0)) return true;
  return false;
}
