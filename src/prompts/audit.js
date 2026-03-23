import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing the codebase for health, quality, and risks.",
  "DO NOT modify any files — this is a read-only analysis. Only use: Read, Grep, Glob, Bash (for analysis commands like wc, find, git log, du, npm ls)."
].join(" ");

export const AUDIT_DIMENSIONS = ["security", "codeQuality", "performance", "architecture", "testing"];

const VALID_HEALTH = new Set(["good", "fair", "poor", "critical"]);
const VALID_SCORES = new Set(["A", "B", "C", "D", "F"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_IMPACT = new Set(["high", "medium", "low"]);

export function buildAuditPrompt({ task, instructions, dimensions = null, context = null }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a codebase auditor for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the project across multiple dimensions and produce a comprehensive health report.",
    "DO NOT modify any files. This is a READ-ONLY analysis."
  );

  const activeDimensions = dimensions
    ? dimensions.filter(d => AUDIT_DIMENSIONS.includes(d))
    : AUDIT_DIMENSIONS;

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

  sections.push(
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"ok":true,"result":{"summary":{"overallHealth":"good|fair|poor|critical","totalFindings":number,"critical":number,"high":number,"medium":number,"low":number},"dimensions":{"security":{"score":"A|B|C|D|F","findings":[]},"codeQuality":{"score":"A|B|C|D|F","findings":[]},"performance":{"score":"A|B|C|D|F","findings":[]},"architecture":{"score":"A|B|C|D|F","findings":[]},"testing":{"score":"A|B|C|D|F","findings":[]}},"topRecommendations":[{"priority":number,"dimension":string,"action":string,"impact":"high|medium|low","effort":"high|medium|low"}]},"summary":string}',
    'Each finding: {"severity":"critical|high|medium|low","file":string,"line":number,"rule":string,"description":string,"recommendation":string}',
    `Only include dimensions you were asked to analyze: ${activeDimensions.join(", ")}`
  );

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
