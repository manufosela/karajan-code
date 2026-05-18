import { extractFirstJson } from "../utils/json-extract.js";
import { groupIssuesBySeverity } from "../audit/sonar-findings.js";
import { groupVulnerabilitiesBySeverity } from "../audit/osv-findings.js";
import { groupFindingsBySeverity as groupSemgrepBySeverity } from "../audit/semgrep-findings.js";
import { formatCwvVerdict } from "../audit/webperf-input.js";

const MAX_SONAR_ISSUES_IN_PROMPT = 50;
const MAX_OSV_VULNS_IN_PROMPT = 50;
const MAX_SEMGREP_FINDINGS_IN_PROMPT = 50;

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing the codebase for health, quality, and risks.",
  "DO NOT modify any files — this is a read-only analysis. Only use: Read, Grep, Glob, Bash (for analysis commands like wc, find, git log, du, npm ls)."
].join(" ");

export const AUDIT_DIMENSIONS = ["security", "codeQuality", "performance", "architecture", "testing", "accessibility"];

// Dimensions that only apply to frontend / fullstack projects. Auto-dropped
// from the default dimension list when stack detection knows the project
// is backend-only — preserves activation when the user explicitly opts in
// via --dimensions=accessibility (KJC-TSK-0359).
const FRONTEND_ONLY_DIMENSIONS = new Set(["accessibility"]);

const VALID_HEALTH = new Set(["good", "fair", "poor", "critical"]);
const VALID_SCORES = new Set(["A", "B", "C", "D", "F"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_IMPACT = new Set(["high", "medium", "low"]);

export function buildAuditPrompt({ task, instructions, dimensions = null, context = null, basalCost = null, growthDelta = null, stack = null, sonarFindings = null, webperf = null, osvFindings = null, semgrepFindings = null, circularDeps = null }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a codebase auditor for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the project across multiple dimensions and produce a comprehensive health report.",
    "DO NOT modify any files. This is a READ-ONLY analysis."
  );

  // Stack hint — when detected, tells the LLM what kind of project this is
  // so it can filter out irrelevant heuristics (e.g. don't flag bundle size
  // in an Express-only API; don't flag N+1 queries in a static Astro site).
  // Detected by src/utils/stack-detect.js — KJC-TSK-0358.
  if (stack && (stack.frameworks?.length > 0 || stack.language || stack.isFrontend || stack.isBackend)) {
    const stackLines = ["## Project Stack"];
    if (stack.language) stackLines.push(`- Language: ${stack.language}`);
    if (stack.frameworks?.length) stackLines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
    const tier = stack.isFullstack
      ? "fullstack (frontend + backend)"
      : stack.isFrontend
        ? "frontend-only"
        : stack.isBackend
          ? "backend-only"
          : "unknown";
    stackLines.push(`- Tier: ${tier}`);
    if (stack.isFullstack) {
      stackLines.push("Apply BOTH backend heuristics (queries, sync I/O, caching) AND frontend heuristics (bundle size, lazy loading, render-blocking) where each layer applies.");
    } else if (stack.isFrontend) {
      stackLines.push("This project is frontend-only. SKIP findings about N+1 queries, sync file I/O in request handlers, missing pagination on list endpoints, and other backend-specific patterns. Focus on bundle size, lazy loading, render-blocking resources, image optimisation, and accessibility hints.");
    } else if (stack.isBackend) {
      stackLines.push("This project is backend-only. SKIP findings about bundle size, lazy loading, render-blocking resources, image optimisation, and frontend accessibility. Focus on queries, sync I/O, pagination, caching, auth/authz, and dependency hygiene.");
    }
    sections.push(stackLines.join("\n"));
  }

  // When dimensions are explicit, honour them verbatim — even frontend-only
  // dimensions on a backend project (the user knows what they want).
  // When dimensions are absent, default to all but drop frontend-only
  // dimensions if the stack is provably backend-only. Unknown stack falls
  // back to the full list (no false negatives — better an extra section
  // than a missing one).
  let activeDimensions;
  if (dimensions) {
    activeDimensions = dimensions.filter(d => AUDIT_DIMENSIONS.includes(d));
  } else if (stack && stack.isBackend && !stack.isFrontend) {
    activeDimensions = AUDIT_DIMENSIONS.filter(d => !FRONTEND_ONLY_DIMENSIONS.has(d));
  } else {
    activeDimensions = AUDIT_DIMENSIONS;
  }

  if (activeDimensions.includes("security")) {
    sections.push(
      "## Security Analysis",
      [
        "- Hardcoded secrets, API keys, tokens in source code",
        "- SQL/NoSQL injection vectors",
        "- XSS vulnerabilities (innerHTML, dangerouslySetInnerHTML, eval)",
        "- Command injection (exec, spawn with user input)",
        "- Insecure dependencies (check package.json for known vulnerable packages)",
        "- Missing input validation at system boundaries",
        "- Authentication/authorization gaps"
      ].join("\n")
    );
  }

  if (activeDimensions.includes("codeQuality")) {
    sections.push(
      "## Code Quality Analysis (SOLID, DRY, KISS, YAGNI)",
      [
        "- Functions/methods longer than 50 lines",
        "- Files longer than 500 lines",
        "- Duplicated code blocks (same logic in multiple places)",
        "- God classes/modules (too many responsibilities)",
        "- Deep nesting (>4 levels)",
        "- Dead code (unused exports, unreachable branches)",
        "- Missing error handling (uncaught promises, empty catches)",
        "- Over-engineering (abstractions for single use)"
      ].join("\n")
    );
  }

  if (activeDimensions.includes("performance")) {
    sections.push(
      "## Performance Analysis",
      [
        "- N+1 query patterns",
        "- Synchronous file I/O in request handlers",
        "- Missing pagination on list endpoints",
        "- Large bundle imports (importing entire libraries for one function)",
        "- Missing lazy loading",
        "- Expensive operations in loops",
        "- Missing caching opportunities"
      ].join("\n")
    );
  }

  if (activeDimensions.includes("architecture")) {
    sections.push(
      "## Architecture Analysis",
      [
        "- Circular dependencies",
        "- Layer violations (UI importing from data layer directly)",
        "- Coupling between modules (shared mutable state)",
        "- Missing dependency injection",
        "- Inconsistent patterns across the codebase",
        "- Missing or outdated documentation",
        "- Configuration scattered vs centralized"
      ].join("\n")
    );
  }

  if (activeDimensions.includes("testing")) {
    sections.push(
      "## Testing Analysis",
      [
        "- Test coverage gaps (source files without corresponding tests)",
        "- Test quality (assertions per test, meaningful test names)",
        "- Missing edge case coverage",
        "- Test isolation (shared state between tests)",
        "- Flaky test indicators (timeouts, sleep, retries)"
      ].join("\n")
    );
  }

  if (activeDimensions.includes("accessibility")) {
    sections.push(
      "## Accessibility Analysis (WCAG 2.x)",
      [
        "- Missing alt text on <img> tags (decorative images need empty alt=\"\", not absent)",
        "- Form inputs without associated <label> or aria-label",
        "- Heading hierarchy violations (h1 → h3 skipping h2; multiple h1 per page)",
        "- Buttons / links containing only icons without aria-label or visually-hidden text",
        "- Interactive elements built from <div>/<span> without role + keyboard handlers",
        "- ARIA roles misused (presentation on focusable elements, redundant on native semantics)",
        "- Focus management gaps (modals without focus trap, no visible :focus styles, tabindex misuse)",
        "- Colour-only signalling (status indicated by red/green only, no icon or text)",
        "- Static contrast — flag suspicious low-contrast colour pairs in CSS variables / token files",
        "- Missing lang attribute on <html>, missing skip-to-content link, missing landmarks"
      ].join("\n"),
      "Skip findings about colour contrast that require runtime rendering (e.g. computed styles); flag the suspect CSS values and recommend an axe-core/Lighthouse runtime check."
    );
  }

  // JSON schema — keep the per-dimension entries in sync with AUDIT_DIMENSIONS.
  const schemaDimensions = AUDIT_DIMENSIONS
    .map(d => `"${d}":{"score":"A|B|C|D|F","findings":[]}`)
    .join(",");
  sections.push(
    "Return a single valid JSON object and nothing else.",
    `JSON schema: {"ok":true,"result":{"summary":{"overallHealth":"good|fair|poor|critical","totalFindings":number,"critical":number,"high":number,"medium":number,"low":number},"dimensions":{${schemaDimensions}},"topRecommendations":[{"priority":number,"dimension":string,"action":string,"impact":"high|medium|low","effort":"high|medium|low"}]},"summary":string}`,
    'Each finding: {"severity":"critical|high|medium|low","file":string,"line":number,"rule":string,"description":string,"recommendation":string}',
    `Only include dimensions you were asked to analyze: ${activeDimensions.join(", ")}`
  );

  if (basalCost) {
    const lines = [
      "## Basal Cost",
      `- Total source lines: ${basalCost.totalLines}`,
      `- Total source files: ${basalCost.totalFiles}`,
      `- Dependencies: ${basalCost.dependencies?.total ?? 0} (${basalCost.dependencies?.dependencies ?? 0} prod + ${basalCost.dependencies?.devDependencies ?? 0} dev)`
    ];
    if (basalCost.unusedDependencies?.unused?.length > 0) {
      lines.push(`- Unused dependencies: ${basalCost.unusedDependencies.unused.join(", ")}`);
    } else if (basalCost.unusedDependencies?.note) {
      lines.push(`- Unused dependencies: ${basalCost.unusedDependencies.note}`);
    }
    if (basalCost.deadExports?.length > 0) {
      lines.push(`- Dead exports (exported but never imported): ${basalCost.deadExports.length}`);
      for (const de of basalCost.deadExports.slice(0, 20)) {
        lines.push(`  - ${de.name} in ${de.file}`);
      }
      if (basalCost.deadExports.length > 20) {
        lines.push(`  - ... and ${basalCost.deadExports.length - 20} more`);
      }
    }
    if (growthDelta) {
      lines.push("");
      lines.push("### Growth since last audit");
      lines.push(`- Lines: ${growthDelta.lines >= 0 ? "+" : ""}${growthDelta.lines}`);
      lines.push(`- Files: ${growthDelta.files >= 0 ? "+" : ""}${growthDelta.files}`);
      lines.push(`- Dependencies: ${growthDelta.deps >= 0 ? "+" : ""}${growthDelta.deps}`);
      if (growthDelta.since) lines.push(`- Since: ${growthDelta.since}`);
    }
    lines.push("");
    lines.push("Flag if basal cost is growing faster than feature delivery. Recommend elimination of unused code and dependencies.");
    sections.push(lines.join("\n"));
  }

  // Sonar findings — KJC-TSK-0361. Deterministic input from a tool the
  // codebase already runs (kj run + SonarStage). The audit reads existing
  // open issues + quality-gate state instead of re-scanning. Capped at
  // MAX_SONAR_ISSUES_IN_PROMPT total entries (50) across all severities to
  // bound prompt size; the LLM is told the truncated count so it can
  // prioritise.
  if (sonarFindings?.available && (sonarFindings.total > 0 || sonarFindings.qualityGate)) {
    const lines = ["## SonarQube Findings"];
    if (sonarFindings.qualityGate?.status) {
      lines.push(`- Quality gate: ${sonarFindings.qualityGate.status}`);
    }
    if (sonarFindings.total > 0) {
      lines.push(`- Total open issues: ${sonarFindings.total}`);
      const groups = groupIssuesBySeverity(sonarFindings.issues);
      let remaining = MAX_SONAR_ISSUES_IN_PROMPT;
      for (const [severity, issues] of Object.entries(groups)) {
        if (issues.length === 0) continue;
        lines.push("");
        lines.push(`### ${severity} (${issues.length})`);
        const slice = issues.slice(0, Math.max(0, remaining));
        for (const issue of slice) {
          const loc = issue.component ? `${issue.component}${issue.line ? `:${issue.line}` : ""}` : "";
          const rule = issue.rule ? ` [${issue.rule}]` : "";
          lines.push(`  - ${loc}${rule} ${issue.message || ""}`.trim());
        }
        if (issues.length > slice.length) {
          lines.push(`  - ... and ${issues.length - slice.length} more in ${severity}`);
        }
        remaining -= slice.length;
      }
    }
    lines.push("");
    lines.push("Cross-reference these with your own findings. When your finding overlaps a Sonar rule, mention the rule ID in the `rule` field — that's a high-confidence match. Findings the LLM raises that Sonar can't see (architecture, naming, API design) are still valuable; mark them with rule names like \"AUDIT-ARCH-N\".");
    sections.push(lines.join("\n"));
  }

  // WebPerf — KJC-TSK-0360. Two modes: a real CWV measurement when one is
  // surfaced via config.webperf.lastResult (future `kj webperf` command)
  // OR static frontend-perf hints for the LLM to look at the source code
  // when no live measurement is available. Backend-only projects skip the
  // section entirely (collectWebPerfInput returns available:false).
  if (webperf?.available) {
    const lines = ["## WebPerf — Frontend Performance"];
    if (webperf.mode === "cwv-result") {
      lines.push("Live Core Web Vitals measurement available — incorporate the verdict below into the performance dimension findings:");
      lines.push("");
      lines.push(formatCwvVerdict(webperf));
      lines.push("");
      lines.push("If a metric is `poor`, recommend a concrete code change (preconnect, lazy-load, image format, critical CSS, defer script). Cite the offending file or pattern when you can find it in the source.");
    } else {
      lines.push("No live CWV measurement was provided. Audit the source for these static frontend-perf patterns and include findings under the `performance` dimension:");
      lines.push("");
      lines.push("- Render-blocking `<link rel=\"stylesheet\">` or `<script>` without `defer`/`async` in `<head>`");
      lines.push("- Large JavaScript bundles imported eagerly that could be `await import(...)` or split by route");
      lines.push("- Non-modern image formats (only .jpg/.png) where webp/avif are widely supported");
      lines.push("- `<img>` without `width`/`height` attributes (causes CLS)");
      lines.push("- `<img>` without `loading=\"lazy\"` for off-screen images, or videos auto-playing without `preload=\"metadata\"`");
      lines.push("- Web fonts loaded without `font-display: swap` or without `<link rel=\"preconnect\">` to the font origin");
      lines.push("- Whole-library imports for one helper (e.g. `import _ from 'lodash'` instead of `lodash/get`)");
      lines.push("- Missing critical CSS extraction or above-the-fold inlining strategy in build config");
      lines.push("- Large third-party scripts (analytics, A/B, chat widgets) without defer + facade pattern");
      lines.push("- Unbounded list rendering without virtualisation for very long collections");
    }
    sections.push(lines.join("\n"));
  }

  // OSV vulnerabilities — KJC-TSK-0365. Deterministic CVE/GHSA findings
  // from osv-scanner across the dependency manifest. Capped at
  // MAX_OSV_VULNS_IN_PROMPT entries; the LLM is told the truncated count.
  // Findings fold into the `security` dimension with the upstream
  // identifier (CVE-/GHSA-) as the rule.
  if (osvFindings?.available && (osvFindings.total > 0)) {
    const lines = ["## OSV Vulnerabilities"];
    lines.push(`- Total open vulnerabilities in dependencies: ${osvFindings.total}`);
    const groups = groupVulnerabilitiesBySeverity(osvFindings.vulnerabilities);
    let remaining = MAX_OSV_VULNS_IN_PROMPT;
    for (const [severity, vulns] of Object.entries(groups)) {
      if (vulns.length === 0) continue;
      lines.push("");
      lines.push(`### ${severity} (${vulns.length})`);
      const slice = vulns.slice(0, Math.max(0, remaining));
      for (const vuln of slice) {
        const where = vuln.package ? `${vuln.package}@${vuln.version || "?"}` : "(unknown package)";
        const fixed = vuln.fixed ? ` → fixed in ${vuln.fixed}` : "";
        lines.push(`  - ${vuln.id} ${where}${fixed}: ${vuln.summary || ""}`.trim());
      }
      if (vulns.length > slice.length) {
        lines.push(`  - ... and ${vulns.length - slice.length} more in ${severity}`);
      }
      remaining -= slice.length;
    }
    lines.push("");
    lines.push("These CVE/GHSA findings are GROUND TRUTH — incorporate them into the `security` dimension. Use the OSV id (CVE-XXXX-XXXX or GHSA-xxxx-xxxx-xxxx) as the `rule` field. Recommend the fixed version when available.");
    sections.push(lines.join("\n"));
  }

  // Semgrep SAST findings — KJC-TSK-0366. Static analysis catches what
  // sonar/CVE-DBs miss: SQL/Cmd injection, XSS, hardcoded secrets,
  // taint flow, language-specific anti-patterns. Capped at
  // MAX_SEMGREP_FINDINGS_IN_PROMPT entries; LLM is told these are
  // deterministic and asked to use rule IDs as-is in findings.
  if (semgrepFindings?.available && semgrepFindings.total > 0) {
    const lines = ["## Semgrep SAST Findings"];
    lines.push(`- Total findings: ${semgrepFindings.total}`);
    const groups = groupSemgrepBySeverity(semgrepFindings.findings);
    let remaining = MAX_SEMGREP_FINDINGS_IN_PROMPT;
    for (const [severity, findings] of Object.entries(groups)) {
      if (findings.length === 0) continue;
      lines.push("");
      lines.push(`### ${severity} (${findings.length})`);
      const slice = findings.slice(0, Math.max(0, remaining));
      for (const f of slice) {
        const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
        const cwe = f.cwe ? ` (${Array.isArray(f.cwe) ? f.cwe.join(", ") : f.cwe})` : "";
        lines.push(`  - ${loc} [${f.rule}]${cwe}: ${f.message || ""}`.trim());
      }
      if (findings.length > slice.length) {
        lines.push(`  - ... and ${findings.length - slice.length} more in ${severity}`);
      }
      remaining -= slice.length;
    }
    lines.push("");
    lines.push("These SAST findings are GROUND TRUTH — fold ERROR-severity ones into the `security` dimension as critical/high findings. Use the semgrep rule id (e.g. javascript.express.security.audit.xss.direct-response-write) verbatim in the `rule` field; that lets the developer look it up in the semgrep registry.");
    sections.push(lines.join("\n"));
  }

  // Madge circular-import findings — KJC-TSK v2.17. Stack-aware, JS/TS only.
  if (circularDeps?.available && circularDeps.total > 0) {
    const lines = ["## Circular Import Cycles"];
    lines.push(`- Total cycles: ${circularDeps.total}`);
    const slice = (circularDeps.cycles || []).slice(0, 30);
    for (const c of slice) {
      const chain = (c.cycle || []).join(" → ");
      lines.push(`  - [${c.severity}] ${chain} → ${c.cycle?.[0] || ""}`);
    }
    if (circularDeps.cycles?.length > slice.length) {
      lines.push(`  - ... ${circularDeps.cycles.length - slice.length} more cycles`);
    }
    lines.push("");
    lines.push("These cycles are GROUND TRUTH (deterministic, no LLM guessing). Fold them into the `architecture` dimension. Use `madge:circular-import` as the rule field. MAJOR severity = chain length ≥ 4 files; MINOR = shorter chains. Recommend the standard fix: extract a third module that both ends depend on, or break the cycle with a typeof/inline import.");
    sections.push(lines.join("\n"));
  }

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  sections.push(`## Task\n${task}`);

  return sections.join("\n\n");
}

function parseFinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const severity = String(raw.severity || "").toLowerCase();
  if (!VALID_SEVERITIES.has(severity)) return null;
  return {
    severity,
    file: raw.file || "",
    line: typeof raw.line === "number" ? raw.line : 0,
    rule: raw.rule || "",
    description: raw.description || "",
    recommendation: raw.recommendation || ""
  };
}

function parseDimension(raw) {
  if (!raw || typeof raw !== "object") return { score: "F", findings: [] };
  const score = VALID_SCORES.has(raw.score) ? raw.score : "F";
  const findings = (Array.isArray(raw.findings) ? raw.findings : [])
    .map(parseFinding)
    .filter(Boolean);
  return { score, findings };
}

function parseRecommendation(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    priority: typeof raw.priority === "number" ? raw.priority : 99,
    dimension: raw.dimension || "",
    action: raw.action || "",
    impact: VALID_IMPACT.has(raw.impact) ? raw.impact : "medium",
    effort: VALID_IMPACT.has(raw.effort) ? raw.effort : "medium"
  };
}

export function parseAuditOutput(raw) {
  const parsed = extractFirstJson(raw);
  if (!parsed) return null;

  // Handle both wrapped (result.summary) and flat structures
  const resultObj = parsed.result || parsed;
  const summaryObj = resultObj.summary || {};

  const overallHealth = VALID_HEALTH.has(summaryObj.overallHealth)
    ? summaryObj.overallHealth
    : "poor";

  const dims = resultObj.dimensions || {};
  const dimensions = {};
  for (const d of AUDIT_DIMENSIONS) {
    dimensions[d] = parseDimension(dims[d]);
  }

  const totalFindings = Object.values(dimensions)
    .reduce((sum, d) => sum + d.findings.length, 0);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const d of Object.values(dimensions)) {
    for (const f of d.findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    }
  }

  const topRecommendations = (Array.isArray(resultObj.topRecommendations) ? resultObj.topRecommendations : [])
    .map(parseRecommendation)
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority);

  return {
    summary: {
      overallHealth,
      totalFindings,
      critical: bySeverity.critical,
      high: bySeverity.high,
      medium: bySeverity.medium,
      low: bySeverity.low
    },
    dimensions,
    topRecommendations,
    textSummary: parsed.summary || resultObj.textSummary || ""
  };
}
