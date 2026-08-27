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
import { groupFindingsBySeverity as groupSemgrepBySeverity } from "./semgrep-findings.js";
import { groupCyclesBySeverity } from "./circular-deps.js";
import { groupDeadExportsBySeverity } from "./dead-exports.js";
import { groupInjectionBySeverity } from "./injection-findings.js";

const MAX_SAMPLE_DEAD_EXPORTS = 10;
const MAX_SAMPLE_SONAR_PER_SEVERITY = 5;
const MAX_SAMPLE_OSV_PER_SEVERITY = 5;
const MAX_SAMPLE_SEMGREP_PER_SEVERITY = 5;
const MAX_SAMPLE_CYCLES_PER_SEVERITY = 5;
const MAX_SAMPLE_KNIP_PER_SEVERITY = 5;
const MAX_SAMPLE_INJECTION_PER_SEVERITY = 5;

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
  if (ctx.semgrepFindings) lines.push(...formatSemgrepBlock(ctx.semgrepFindings));
  if (ctx.infraFindings) lines.push(...formatInfraBlock(ctx.infraFindings));
  if (ctx.circularDeps) lines.push(...formatCircularDepsBlock(ctx.circularDeps));
  if (ctx.deadExports) lines.push(...formatDeadExportsBlock(ctx.deadExports));
  if (ctx.injectionFindings) lines.push(...formatInjectionBlock(ctx.injectionFindings));
  if (ctx.aiSlop) lines.push(...formatAiSlopBlock(ctx.aiSlop));
  if (ctx.webperf) lines.push(...formatWebperfBlock(ctx.webperf));

  return lines.join("\n");
}

function formatAiSlopBlock(slop) {
  if (!slop.available) return ["### AI-slop tells (deterministic)", `- Status: not available — ${slop.reason || "scan failed"}`, ""];
  const lines = ["### AI-slop tells (deterministic)", `- Files scanned: ${slop.filesScanned ?? 0}`, `- Score: ${slop.score}/100 (100 = clean)`, `- Findings: ${slop.total ?? 0}`];
  if ((slop.total ?? 0) > 0) {
    for (const [cat, n] of Object.entries(slop.byCategory || {})) {
      if (n > 0) lines.push(`  - ${cat}: ${n}`);
    }
    if (Array.isArray(slop.worst) && slop.worst.length > 0) {
      lines.push("  - Worst offenders:");
      for (const f of slop.worst) lines.push(`    - ${f.path}:${f.line} [${f.category}] ${f.snippet}`);
    }
  }
  lines.push("");
  return lines;
}

function formatInjectionBlock(inj) {
  if (!inj.available) return ["### Prompt-injection scan", `- Status: not available — ${inj.reason || "scan failed"}`, ""];
  const lines = ["### Prompt-injection scan (agent-context surface: CLAUDE/AGENTS/GEMINI.md, templates, .rulesync, .karajan)", `- Files scanned: ${inj.scanned ?? 0}`, `- Findings: ${inj.total ?? 0}`];
  if ((inj.total ?? 0) > 0) {
    for (const [severity, items] of Object.entries(groupInjectionBySeverity(inj.findings || []))) {
      if (items.length === 0) continue;
      lines.push(`  - ${severity} (${items.length}):`);
      for (const f of items.slice(0, MAX_SAMPLE_INJECTION_PER_SEVERITY)) {
        const lineSuffix = f.line ? `:${f.line}` : "";
        lines.push(`    - ${f.file || "(unknown)"}${lineSuffix} [${f.type}] ${f.pattern}`);
      }
      if (items.length > MAX_SAMPLE_INJECTION_PER_SEVERITY) lines.push(`    - ... and ${items.length - MAX_SAMPLE_INJECTION_PER_SEVERITY} more in ${severity}`);
    }
  }
  lines.push("");
  return lines;
}

function formatCircularDepsBlock(circularDeps) {
  if (!circularDeps.available) {
    return ["### Circular Dependencies (architecture)", `- Status: not available — ${circularDeps.reason || "madge not available"}`, ""];
  }
  const lines = ["### Circular Dependencies (architecture)"];
  const suppressedSuffix = circularDeps.suppressedCount ? ` (+${circularDeps.suppressedCount} suppressed)` : "";
  lines.push(`- Total cycles: ${circularDeps.total ?? 0}${suppressedSuffix}`);
  if ((circularDeps.total ?? 0) > 0) {
    const groups = groupCyclesBySeverity(circularDeps.cycles || []);
    for (const [severity, cycles] of Object.entries(groups)) {
      if (cycles.length === 0) continue;
      lines.push(`  - ${severity} (${cycles.length}):`);
      for (const c of cycles.slice(0, MAX_SAMPLE_CYCLES_PER_SEVERITY)) {
        const head = (c.cycle || [c.path]).slice(0, 3).join(" → ");
        const more = (c.cycle?.length || 0) > 3 ? ` → … (${c.cycle.length} files)` : "";
        lines.push(`    - ${head}${more}`);
      }
      if (cycles.length > MAX_SAMPLE_CYCLES_PER_SEVERITY) {
        lines.push(`    - ... and ${cycles.length - MAX_SAMPLE_CYCLES_PER_SEVERITY} more in ${severity}`);
      }
    }
    if (circularDeps.truncated > 0) lines.push(`  - ... ${circularDeps.truncated} more cycles not shown`);
  }
  lines.push("");
  return lines;
}

function formatSemgrepBlock(semgrepFindings) {
  if (!semgrepFindings.available) {
    return ["### Semgrep SAST", `- Status: not available — ${semgrepFindings.reason || "semgrep not installed"}`, ""];
  }
  const lines = ["### Semgrep SAST"];
  lines.push(`- Total findings: ${semgrepFindings.total ?? 0}`);
  if ((semgrepFindings.total ?? 0) > 0) {
    const groups = groupSemgrepBySeverity(semgrepFindings.findings || []);
    for (const [severity, findings] of Object.entries(groups)) {
      if (findings.length === 0) continue;
      lines.push(`  - ${severity} (${findings.length}):`);
      for (const f of findings.slice(0, MAX_SAMPLE_SEMGREP_PER_SEVERITY)) {
        const lineSuffix = f.line ? `:${f.line}` : "";
        const loc = f.file ? `${f.file}${lineSuffix}` : "";
        lines.push(`    - ${loc} [${f.rule}]`);
      }
      if (findings.length > MAX_SAMPLE_SEMGREP_PER_SEVERITY) {
        lines.push(`    - ... and ${findings.length - MAX_SAMPLE_SEMGREP_PER_SEVERITY} more in ${severity}`);
      }
    }
  }
  lines.push("");
  return lines;
}

// INF-C (KJC-TSK-0760): checkov misconfigs — same shape as the semgrep
// block; a not-applicable repo (no infra markers) declares it in one line.
function formatInfraBlock(infraFindings) {
  if (!infraFindings.available) {
    return ["### Infra misconfigurations (checkov)", `- Status: not available — ${infraFindings.reason || "checkov not installed"}`, ""];
  }
  const lines = ["### Infra misconfigurations (checkov)"];
  lines.push(`- Total findings: ${infraFindings.total ?? 0}`);
  const cap = MAX_SAMPLE_SEMGREP_PER_SEVERITY * 3;
  for (const f of (infraFindings.findings || []).slice(0, cap)) {
    const lineSuffix = f.line ? `:${f.line}` : "";
    lines.push(`  - [${f.severity}] ${f.file}${lineSuffix} [${f.rule}] ${f.message}${f.guideline ? ` (${f.guideline})` : ""}`);
  }
  const overflow = (infraFindings.total ?? 0) - cap;
  if (overflow > 0) lines.push(`  - ... and ${overflow} more`);
  lines.push("");
  return lines;
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

function formatDeadExportsBlock(deadExports) {
  if (!deadExports.available) {
    return ["### Dead Code (knip)", `- Status: not available — ${deadExports.reason || "knip not available"}`, ""];
  }
  const lines = ["### Dead Code (knip)"];
  const exportsTotal = (deadExports.exports || []).length;
  const filesTotal = (deadExports.files || []).length;
  const reported = exportsTotal + filesTotal;
  const suppressed = deadExports.suppressedCount || 0;
  // AC8 (KJC-TSK-0794): derivative first; then how many ENTERED and how many
  // were FILTERED — a shrinking number must never hide a shrinking scan.
  const prev = deadExports.previous;
  if (prev && typeof prev.exports === "number") {
    const d = reported - (prev.exports + (prev.files || 0));
    lines.push(`- Δ dead code: ${d >= 0 ? "+" : ""}${d} since ${prev.timestamp || "last audit"} (now ${reported})`);
  }
  lines.push(`- ${reported + suppressed} entered the scan, ${suppressed} filtered as declared false positives, ${reported} reported`);
  lines.push(`- Unused exports/types: ${exportsTotal}`);
  lines.push(`- Unused files: ${filesTotal}`);
  const allItems = [...(deadExports.exports || []), ...(deadExports.files || [])];
  if (allItems.length > 0) {
    const groups = groupDeadExportsBySeverity(allItems);
    for (const [severity, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      lines.push(`  - ${severity} (${items.length}):`);
      for (const item of items.slice(0, MAX_SAMPLE_KNIP_PER_SEVERITY)) {
        const lineSuffix = item.line ? `:${item.line}` : "";
        const nameSuffix = item.name ? ` \`${item.name}\`` : "";
        lines.push(`    - ${item.path}${lineSuffix} [${item.rule}]${nameSuffix}`);
      }
      if (items.length > MAX_SAMPLE_KNIP_PER_SEVERITY) {
        lines.push(`    - ... and ${items.length - MAX_SAMPLE_KNIP_PER_SEVERITY} more in ${severity}`);
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
  // AC8 (KJC-TSK-0794): the DERIVATIVE leads — "went from N to M" is what a
  // reader acts on; the absolute is the secondary datum.
  const dDelta = growthDelta?.deadExports;
  const lead = typeof dDelta === "number" ? `${dDelta >= 0 ? "+" : ""}${dDelta} since last audit — ` : "";
  if (dead.length > 0) {
    lines.push(`- Dead exports: ${lead}${dead.length} total`);
    for (const de of dead.slice(0, MAX_SAMPLE_DEAD_EXPORTS)) {
      lines.push(`  - \`${de.name}\` in ${de.file}`);
    }
    if (dead.length > MAX_SAMPLE_DEAD_EXPORTS) {
      lines.push(`  - ... and ${dead.length - MAX_SAMPLE_DEAD_EXPORTS} more`);
    }
  } else {
    lines.push(`- Dead exports: ${lead}0`);
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
        const lineSuffix = issue.line ? `:${issue.line}` : "";
        const loc = issue.component ? `${issue.component}${lineSuffix}` : "";
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
  if (ctx.semgrepFindings?.available && (ctx.semgrepFindings.total ?? 0) > 0) return true;
  if (ctx.infraFindings?.available && (ctx.infraFindings.total ?? 0) > 0) return true;
  if (ctx.circularDeps?.available && (ctx.circularDeps.total ?? 0) > 0) return true;
  if (ctx.deadExports?.available && (ctx.deadExports.total ?? 0) > 0) return true;
  if (ctx.growthDelta && (Math.abs(ctx.growthDelta.lines || 0) > 100 || Math.abs(ctx.growthDelta.deps || 0) > 0)) return true;
  if (ctx.aiSlop?.available && (ctx.aiSlop.total ?? 0) > 0) return true;
  return false;
}
