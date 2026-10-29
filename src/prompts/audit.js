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

/**
 * KJC-TSK-1257: one function per section; each returns its text, or null when it does not apply.
 * The order of the sections is the prompt's contract (tests/prompts/audit-prompt-snapshot.test.js).
 */
export function buildAuditPrompt({ task, instructions, dimensions = null, context = null, basalCost = null, growthDelta = null, stack = null, sonarFindings = null, webperf = null, osvFindings = null, semgrepFindings = null, circularDeps = null, deadExports = null }) {
  const activeDimensions = activeDimensionsOf(dimensions, stack);
  return [
    SUBAGENT_PREAMBLE,
    instructions,
    "You are a codebase auditor for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the project across multiple dimensions and produce a comprehensive health report.",
    "DO NOT modify any files. This is a READ-ONLY analysis.",
    stackSection(stack),
    ...AUDIT_DIMENSIONS.filter((d) => activeDimensions.includes(d)).flatMap(dimensionSection),
    ...schemaSections(activeDimensions),
    basalCostSection(basalCost, growthDelta),
    sonarSection(sonarFindings),
    webperfSection(webperf),
    osvSection(osvFindings),
    semgrepSection(semgrepFindings),
    deadCodeSection(deadExports),
    circularSection(circularDeps),
    context ? `## Context\n${context}` : null,
    `## Task\n${task}`,
  ].filter(Boolean).join("\n\n");
}

// Stack hint — when detected, tells the LLM what kind of project this is
// so it can filter out irrelevant heuristics (e.g. don't flag bundle size
// in an Express-only API; don't flag N+1 queries in a static Astro site).
// Detected by src/utils/stack-detect.js — KJC-TSK-0358.
const TIER_HINTS = {
  fullstack: "Apply BOTH backend heuristics (queries, sync I/O, caching) AND frontend heuristics (bundle size, lazy loading, render-blocking) where each layer applies.",
  frontend: "This project is frontend-only. SKIP findings about N+1 queries, sync file I/O in request handlers, missing pagination on list endpoints, and other backend-specific patterns. Focus on bundle size, lazy loading, render-blocking resources, image optimisation, and accessibility hints.",
  backend: "This project is backend-only. SKIP findings about bundle size, lazy loading, render-blocking resources, image optimisation, and frontend accessibility. Focus on queries, sync I/O, pagination, caching, auth/authz, and dependency hygiene.",
};
const TIER_NAMES = { fullstack: "fullstack (frontend + backend)", frontend: "frontend-only", backend: "backend-only" };

function tierOf(stack) {
  if (stack.isFullstack) return "fullstack";
  if (stack.isFrontend) return "frontend";
  return stack.isBackend ? "backend" : null;
}

function stackSection(stack) {
  if (!stack || !(stack.frameworks?.length > 0 || stack.language || stack.isFrontend || stack.isBackend)) return null;
  const tier = tierOf(stack);
  const lines = ["## Project Stack"];
  if (stack.language) lines.push(`- Language: ${stack.language}`);
  if (stack.frameworks?.length) lines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
  lines.push(`- Tier: ${TIER_NAMES[tier] ?? "unknown"}`);
  if (tier) lines.push(TIER_HINTS[tier]);
  return lines.join("\n");
}

// When dimensions are explicit, honour them verbatim — even frontend-only
// dimensions on a backend project (the user knows what they want).
// When dimensions are absent, default to all but drop frontend-only
// dimensions if the stack is provably backend-only. Unknown stack falls
// back to the full list (no false negatives — better an extra section
// than a missing one).
function activeDimensionsOf(dimensions, stack) {
  if (dimensions) return dimensions.filter((d) => AUDIT_DIMENSIONS.includes(d));
  if (stack?.isBackend && !stack.isFrontend) return AUDIT_DIMENSIONS.filter((d) => !FRONTEND_ONLY_DIMENSIONS.has(d));
  return AUDIT_DIMENSIONS;
}

const DIMENSION_CHECKS = {
  security: { title: "## Security Analysis", checks: [
    "- Hardcoded secrets, API keys, tokens in source code",
    "- SQL/NoSQL injection vectors",
    "- XSS vulnerabilities (innerHTML, dangerouslySetInnerHTML, eval)",
    "- Command injection (exec, spawn with user input)",
    "- Insecure dependencies (check package.json for known vulnerable packages)",
    "- Missing input validation at system boundaries",
    "- Authentication/authorization gaps",
  ] },
  codeQuality: { title: "## Code Quality Analysis (SOLID, DRY, KISS, YAGNI)", checks: [
    "- Functions/methods longer than 50 lines",
    "- Files longer than 500 lines",
    "- Duplicated code blocks (same logic in multiple places)",
    "- God classes/modules (too many responsibilities)",
    "- Deep nesting (>4 levels)",
    "- Dead code (unused exports, unreachable branches)",
    "- Missing error handling (uncaught promises, empty catches)",
    "- Over-engineering (abstractions for single use)",
  ] },
  performance: { title: "## Performance Analysis", checks: [
    "- N+1 query patterns",
    "- Synchronous file I/O in request handlers",
    "- Missing pagination on list endpoints",
    "- Large bundle imports (importing entire libraries for one function)",
    "- Missing lazy loading",
    "- Expensive operations in loops",
    "- Missing caching opportunities",
  ] },
  architecture: { title: "## Architecture Analysis", checks: [
    "- Circular dependencies",
    "- Layer violations (UI importing from data layer directly)",
    "- Coupling between modules (shared mutable state)",
    "- Missing dependency injection",
    "- Inconsistent patterns across the codebase",
    "- Missing or outdated documentation",
    "- Configuration scattered vs centralized",
  ] },
  testing: { title: "## Testing Analysis", checks: [
    "- Test coverage gaps (source files without corresponding tests)",
    "- Test quality (assertions per test, meaningful test names)",
    "- Missing edge case coverage",
    "- Test isolation (shared state between tests)",
    "- Flaky test indicators (timeouts, sleep, retries)",
  ] },
  accessibility: { title: "## Accessibility Analysis (WCAG 2.x)", checks: [
    "- Missing alt text on <img> tags (decorative images need empty alt=\"\", not absent)",
    "- Form inputs without associated <label> or aria-label",
    "- Heading hierarchy violations (h1 → h3 skipping h2; multiple h1 per page)",
    "- Buttons / links containing only icons without aria-label or visually-hidden text",
    "- Interactive elements built from <div>/<span> without role + keyboard handlers",
    "- ARIA roles misused (presentation on focusable elements, redundant on native semantics)",
    "- Focus management gaps (modals without focus trap, no visible :focus styles, tabindex misuse)",
    "- Colour-only signalling (status indicated by red/green only, no icon or text)",
    "- Static contrast — flag suspicious low-contrast colour pairs in CSS variables / token files",
    "- Missing lang attribute on <html>, missing skip-to-content link, missing landmarks",
  ], note: "Skip findings about colour contrast that require runtime rendering (e.g. computed styles); flag the suspect CSS values and recommend an axe-core/Lighthouse runtime check." },
};

function dimensionSection(dimension) {
  const { title, checks, note } = DIMENSION_CHECKS[dimension];
  return note ? [title, checks.join("\n"), note] : [title, checks.join("\n")];
}

// JSON schema — keep the per-dimension entries in sync with AUDIT_DIMENSIONS.
function schemaSections(activeDimensions) {
  const schemaDimensions = AUDIT_DIMENSIONS.map((d) => `"${d}":{"score":"A|B|C|D|F","findings":[]}`).join(",");
  return [
    "Return a single valid JSON object and nothing else.",
    `JSON schema: {"ok":true,"result":{"summary":{"overallHealth":"good|fair|poor|critical","totalFindings":number,"critical":number,"high":number,"medium":number,"low":number},"dimensions":{${schemaDimensions}},"topRecommendations":[{"priority":number,"dimension":string,"action":string,"impact":"high|medium|low","effort":"high|medium|low"}]},"summary":string}`,
    'Each finding: {"severity":"critical|high|medium|low","file":string,"line":number,"rule":string,"description":string,"recommendation":string}',
    `Only include dimensions you were asked to analyze: ${activeDimensions.join(", ")}`,
  ];
}

const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

function basalCostSection(basalCost, growthDelta) {
  if (!basalCost) return null;
  const deps = basalCost.dependencies ?? {};
  return [
    "## Basal Cost",
    `- Total source lines: ${basalCost.totalLines}`,
    `- Total source files: ${basalCost.totalFiles}`,
    `- Dependencies: ${deps.total ?? 0} (${deps.dependencies ?? 0} prod + ${deps.devDependencies ?? 0} dev)`,
    ...unusedDependencyLines(basalCost.unusedDependencies),
    ...deadExportLines(basalCost.deadExports ?? []),
    ...growthLines(growthDelta),
    "",
    "Flag if basal cost is growing faster than feature delivery. Recommend elimination of unused code and dependencies.",
  ].join("\n");
}

function unusedDependencyLines(unused) {
  if (unused?.unused?.length > 0) return [`- Unused dependencies: ${unused.unused.join(", ")}`];
  return unused?.note ? [`- Unused dependencies: ${unused.note}`] : [];
}

function deadExportLines(dead) {
  if (dead.length === 0) return [];
  const more = dead.length > 20 ? [`  - ... and ${dead.length - 20} more`] : [];
  return [`- Dead exports (exported but never imported): ${dead.length}`, ...dead.slice(0, 20).map((de) => `  - ${de.name} in ${de.file}`), ...more];
}

function growthLines(growthDelta) {
  if (!growthDelta) return [];
  const since = growthDelta.since ? [`- Since: ${growthDelta.since}`] : [];
  return ["", "### Growth since last audit", `- Lines: ${signed(growthDelta.lines)}`, `- Files: ${signed(growthDelta.files)}`, `- Dependencies: ${signed(growthDelta.deps)}`, ...since];
}

/** Findings grouped by severity, at most `max` in total; what is left out is counted per severity. */
function cappedGroups(groups, max, render) {
  const lines = [];
  let remaining = max;
  for (const [severity, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    const slice = items.slice(0, Math.max(0, remaining));
    lines.push("", `### ${severity} (${items.length})`, ...slice.map(render));
    if (items.length > slice.length) lines.push(`  - ... and ${items.length - slice.length} more in ${severity}`);
    remaining -= slice.length;
  }
  return lines;
}

function located(where, line) {
  if (!where) return "";
  return line ? `${where}:${line}` : where;
}

/** A tool's findings count only when it ran and found something (total missing reads as none). */
const hasFindings = (input) => Boolean(input?.available) && (input.total ?? 0) > 0;

// Sonar findings — KJC-TSK-0361. Deterministic input from a tool the
// codebase already runs (kj run + SonarStage). The audit reads existing
// open issues + quality-gate state instead of re-scanning. Capped at
// MAX_SONAR_ISSUES_IN_PROMPT total entries (50) across all severities to
// bound prompt size; the LLM is told the truncated count so it can
// prioritise.
function sonarSection(sonarFindings) {
  if (!sonarFindings?.available || !(sonarFindings.total > 0 || sonarFindings.qualityGate)) return null;
  const lines = ["## SonarQube Findings"];
  if (sonarFindings.qualityGate?.status) lines.push(`- Quality gate: ${sonarFindings.qualityGate.status}`);
  if (sonarFindings.total > 0) {
    lines.push(`- Total open issues: ${sonarFindings.total}`, ...cappedGroups(groupIssuesBySeverity(sonarFindings.issues), MAX_SONAR_ISSUES_IN_PROMPT, (issue) => {
      const rule = issue.rule ? ` [${issue.rule}]` : "";
      return `  - ${located(issue.component, issue.line)}${rule} ${issue.message || ""}`.trim();
    }));
  }
  lines.push("", "Cross-reference these with your own findings. When your finding overlaps a Sonar rule, mention the rule ID in the `rule` field — that's a high-confidence match. Findings the LLM raises that Sonar can't see (architecture, naming, API design) are still valuable; mark them with rule names like \"AUDIT-ARCH-N\".");
  return lines.join("\n");
}

const STATIC_WEBPERF_CHECKS = [
  "- Render-blocking `<link rel=\"stylesheet\">` or `<script>` without `defer`/`async` in `<head>`",
  "- Large JavaScript bundles imported eagerly that could be `await import(...)` or split by route",
  "- Non-modern image formats (only .jpg/.png) where webp/avif are widely supported",
  "- `<img>` without `width`/`height` attributes (causes CLS)",
  "- `<img>` without `loading=\"lazy\"` for off-screen images, or videos auto-playing without `preload=\"metadata\"`",
  "- Web fonts loaded without `font-display: swap` or without `<link rel=\"preconnect\">` to the font origin",
  "- Whole-library imports for one helper (e.g. `import _ from 'lodash'` instead of `lodash/get`)",
  "- Missing critical CSS extraction or above-the-fold inlining strategy in build config",
  "- Large third-party scripts (analytics, A/B, chat widgets) without defer + facade pattern",
  "- Unbounded list rendering without virtualisation for very long collections",
];

// WebPerf — KJC-TSK-0360. Two modes: a real CWV measurement when one is
// surfaced via config.webperf.lastResult (future `kj webperf` command)
// OR static frontend-perf hints for the LLM to look at the source code
// when no live measurement is available. Backend-only projects skip the
// section entirely (collectWebPerfInput returns available:false).
function webperfSection(webperf) {
  if (!webperf?.available) return null;
  const body = webperf.mode === "cwv-result"
    ? ["Live Core Web Vitals measurement available — incorporate the verdict below into the performance dimension findings:", "", formatCwvVerdict(webperf), "", "If a metric is `poor`, recommend a concrete code change (preconnect, lazy-load, image format, critical CSS, defer script). Cite the offending file or pattern when you can find it in the source."]
    : ["No live CWV measurement was provided. Audit the source for these static frontend-perf patterns and include findings under the `performance` dimension:", "", ...STATIC_WEBPERF_CHECKS];
  return ["## WebPerf — Frontend Performance", ...body].join("\n");
}

// OSV vulnerabilities — KJC-TSK-0365. Deterministic CVE/GHSA findings
// from osv-scanner across the dependency manifest. Capped at
// MAX_OSV_VULNS_IN_PROMPT entries; the LLM is told the truncated count.
// Findings fold into the `security` dimension with the upstream
// identifier (CVE-/GHSA-) as the rule.
function osvSection(osvFindings) {
  if (!hasFindings(osvFindings)) return null;
  return [
    "## OSV Vulnerabilities",
    `- Total open vulnerabilities in dependencies: ${osvFindings.total}`,
    ...cappedGroups(groupVulnerabilitiesBySeverity(osvFindings.vulnerabilities), MAX_OSV_VULNS_IN_PROMPT, (vuln) => {
      const where = vuln.package ? `${vuln.package}@${vuln.version || "?"}` : "(unknown package)";
      const fixed = vuln.fixed ? ` → fixed in ${vuln.fixed}` : "";
      return `  - ${vuln.id} ${where}${fixed}: ${vuln.summary || ""}`.trim();
    }),
    "",
    "These CVE/GHSA findings are GROUND TRUTH — incorporate them into the `security` dimension. Use the OSV id (CVE-XXXX-XXXX or GHSA-xxxx-xxxx-xxxx) as the `rule` field. Recommend the fixed version when available.",
  ].join("\n");
}

// Semgrep SAST findings — KJC-TSK-0366. Static analysis catches what
// sonar/CVE-DBs miss: SQL/Cmd injection, XSS, hardcoded secrets,
// taint flow, language-specific anti-patterns. Capped at
// MAX_SEMGREP_FINDINGS_IN_PROMPT entries; LLM is told these are
// deterministic and asked to use rule IDs as-is in findings.
function semgrepSection(semgrepFindings) {
  if (!hasFindings(semgrepFindings)) return null;
  return [
    "## Semgrep SAST Findings",
    `- Total findings: ${semgrepFindings.total}`,
    ...cappedGroups(groupSemgrepBySeverity(semgrepFindings.findings), MAX_SEMGREP_FINDINGS_IN_PROMPT, (f) => {
      const cweText = Array.isArray(f.cwe) ? f.cwe.join(", ") : f.cwe;
      const cwe = f.cwe ? ` (${cweText})` : "";
      return `  - ${located(f.file, f.line)} [${f.rule}]${cwe}: ${f.message || ""}`.trim();
    }),
    "",
    "These SAST findings are GROUND TRUTH — fold ERROR-severity ones into the `security` dimension as critical/high findings. Use the semgrep rule id (e.g. javascript.express.security.audit.xss.direct-response-write) verbatim in the `rule` field; that lets the developer look it up in the semgrep registry.",
  ].join("\n");
}

// Knip dead-exports findings — KJC-TSK v2.17. Stack-aware, JS/TS only.
// Folds into the `codeQuality` dimension as MINOR for unused exports/types
// and MAJOR for unused files (likely real dead code).
function deadCodeSection(deadExports) {
  if (!hasFindings(deadExports)) return null;
  const exports = deadExports.exports || [];
  const files = deadExports.files || [];
  return [
    "## Dead Code (knip)",
    `- Unused exports/types: ${exports.length}`,
    `- Unused files: ${files.length}`,
    ...[...exports, ...files].slice(0, 40).map(deadCodeItem),
    "",
    "These dead-code findings are GROUND TRUTH (deterministic, no LLM guessing). Fold them into the `codeQuality` dimension. Use the knip rule id (`knip:unused-exports`, `knip:unused-types`, `knip:unused-files`) verbatim in the `rule` field. Unused files at MAJOR severity are most likely real dead code; unused exports at MINOR may be public API surface kept for downstream consumers — flag but don't insist on deletion.",
  ].join("\n");
}

function deadCodeItem(item) {
  const line = item.line ? `:${item.line}` : "";
  const name = item.name ? ` \`${item.name}\`` : "";
  return `  - [${item.severity}] ${item.path}${line} [${item.rule}]${name}`;
}

// Madge circular-import findings — KJC-TSK v2.17. Stack-aware, JS/TS only.
function circularSection(circularDeps) {
  if (!hasFindings(circularDeps)) return null;
  const cycles = circularDeps.cycles || [];
  const slice = cycles.slice(0, 30);
  const lines = [
    "## Circular Import Cycles",
    `- Total cycles: ${circularDeps.total}`,
    ...slice.map((c) => `  - [${c.severity}] ${(c.cycle || []).join(" → ")} → ${c.cycle?.[0] || ""}`),
  ];
  if (cycles.length > slice.length) lines.push(`  - ... ${cycles.length - slice.length} more cycles`);
  lines.push("", "These cycles are GROUND TRUTH (deterministic, no LLM guessing). Fold them into the `architecture` dimension. Use `madge:circular-import` as the rule field. MAJOR severity = chain length ≥ 4 files; MINOR = shorter chains. Recommend the standard fix: extract a third module that both ends depend on, or break the cycle with a typeof/inline import.");
  return lines.join("\n");
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
