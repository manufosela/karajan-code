import { VALID_TASK_TYPES } from "./policy-resolver.js";

/**
 * Built-in intent patterns for deterministic pre-triage classification.
 * Each pattern maps keywords/regex to a taskType + complexity level.
 * Evaluated top-down; first match with confidence >= threshold wins.
 */
const INTENT_PATTERNS = [
  // Audit / analysis tasks (no code changes, read-only analysis)
  {
    id: "audit",
    keywords: ["audit", "review", "analyze", "check", "verify", "inspect", "scan", "auditar", "revisar", "analizar", "comprobar", "verificar", "inspeccionar"],
    taskType: "audit",
    level: "simple",
    confidence: 0.9,
    message: "Audit/analysis task detected — skipping coder and reviewer",
  },
  // Documentation-only tasks
  {
    id: "doc-readme",
    keywords: ["readme", "docs", "documentation", "jsdoc", "typedoc", "changelog"],
    taskType: "doc",
    level: "trivial",
    confidence: 0.95,
    message: "Documentation-only task detected",
  },
  // Test-only tasks
  {
    id: "add-tests",
    keywords: ["add test", "write test", "missing test", "test coverage", "add spec", "write spec", "unit test", "integration test"],
    taskType: "add-tests",
    level: "simple",
    confidence: 0.9,
    message: "Test-addition task detected",
  },
  // Refactoring tasks
  {
    id: "refactor",
    keywords: ["refactor", "rename", "extract method", "extract function", "clean up", "cleanup", "reorganize", "restructure", "simplify"],
    taskType: "refactor",
    level: "simple",
    confidence: 0.85,
    message: "Refactoring task detected",
  },
  // Infrastructure / DevOps tasks
  {
    id: "infra-devops",
    keywords: ["ci/cd", "pipeline", "dockerfile", "docker-compose", "kubernetes", "k8s", "terraform", "deploy", "nginx", "github actions", "gitlab ci"],
    taskType: "infra",
    level: "simple",
    confidence: 0.85,
    message: "Infrastructure/DevOps task detected",
  },
  // Trivial fixes (typos, comments, formatting)
  {
    id: "trivial-fix",
    keywords: ["typo", "fix typo", "spelling", "comment", "fix comment", "formatting", "lint", "fix lint", "whitespace"],
    taskType: "sw",
    level: "trivial",
    confidence: 0.9,
    message: "Trivial fix detected",
  },
  // Frontend / UI tasks (sets hasFrontend flag for impeccable role activation)
  {
    id: "frontend-ui",
    keywords: ["html", "css", "ui", "landing", "component", "responsive", "accessibility", "a11y", "frontend", "design", "layout", "styling", "dark mode", "animation"],
    taskType: "sw",
    level: "simple",
    confidence: 0.8,
    message: "Frontend/UI task detected",
    hasFrontend: true,
  },
];

/**
 * Compile custom intent patterns from config.guards.intent.patterns
 * Custom patterns are evaluated BEFORE built-in ones.
 */
export function compileIntentPatterns(configGuards) {
  const custom = Array.isArray(configGuards?.intent?.patterns)
    ? configGuards.intent.patterns.map(p => ({
        id: p.id || "custom-intent",
        keywords: Array.isArray(p.keywords) ? p.keywords : [],
        taskType: VALID_TASK_TYPES.has(p.taskType) ? p.taskType : "sw",
        level: p.level || "simple",
        confidence: typeof p.confidence === "number" ? p.confidence : 0.85,
        message: p.message || "Custom intent pattern matched",
      }))
    : [];

  return [...custom, ...INTENT_PATTERNS];
}

/**
 * Check if a task description matches any of the keywords.
 * Returns true if at least one keyword (case-insensitive substring) appears in the task.
 */
function matchesKeywords(task, keywords) {
  const lower = task.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a task description using deterministic keyword patterns.
 *
 * Returns:
 *   { classified: true, taskType, level, confidence, patternId, message }
 *   or { classified: false } if no pattern matches above threshold
 */
export function classifyIntent(task, config = {}) {
  if (!task || typeof task !== "string") {
    return { classified: false };
  }

  const configGuards = config?.guards || {};
  const threshold = configGuards?.intent?.confidence_threshold ?? 0.85;
  const patterns = compileIntentPatterns(configGuards);

  for (const pattern of patterns) {
    if (!matchesKeywords(task, pattern.keywords)) continue;

    if (pattern.confidence >= threshold) {
      const result = {
        classified: true,
        taskType: pattern.taskType,
        level: pattern.level,
        confidence: pattern.confidence,
        patternId: pattern.id,
        message: pattern.message,
      };
      if (pattern.hasFrontend) result.hasFrontend = true;
      return result;
    }
  }

  return { classified: false };
}

export { INTENT_PATTERNS };
