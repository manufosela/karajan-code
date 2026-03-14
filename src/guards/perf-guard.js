const FRONTEND_EXTENSIONS = new Set([".html", ".htm", ".css", ".jsx", ".tsx", ".astro", ".vue", ".svelte"]);

// Built-in perf anti-patterns (applied to added lines in frontend files)
const PERF_PATTERNS = [
  { id: "img-no-dimensions", pattern: /<img\b(?![^>]*\bwidth\b)(?![^>]*\bheight\b)[^>]*>/i, severity: "warning", message: "Image without width/height attributes (causes CLS)" },
  { id: "img-no-lazy", pattern: /<img\b(?![^>]*\bloading\s*=)(?![^>]*\bfetchpriority\s*=)[^>]*>/i, severity: "info", message: "Image without loading=\"lazy\" or fetchpriority (consider lazy loading)" },
  { id: "script-no-defer", pattern: /<script\b(?![^>]*\b(?:defer|async)\b)(?![^>]*type\s*=\s*["']module["'])[^>]*src\s*=/i, severity: "warning", message: "External script without defer/async (render-blocking)" },
  { id: "font-no-display", pattern: /@font-face\s*\{(?![^}]*font-display)/i, severity: "warning", message: "@font-face without font-display (causes FOIT)" },
  { id: "css-import", pattern: /@import\s+(?:url\()?["'](?!.*\.module\.)/i, severity: "info", message: "CSS @import (causes sequential loading, prefer <link>)" },
  { id: "inline-style-large", pattern: /style\s*=\s*["'][^"']{200,}["']/i, severity: "warning", message: "Large inline style (>200 chars, consider external CSS)" },
  { id: "document-write", pattern: /document\.write\s*\(/, severity: "warning", message: "document.write() blocks parsing and degrades performance" },
];

// Patterns for package.json changes (heavy dependencies added)
const HEAVY_DEPS = [
  { id: "heavy-moment", pattern: /"moment"/, severity: "info", message: "moment.js added (consider dayjs or date-fns for smaller bundle)" },
  { id: "heavy-lodash", pattern: /"lodash"(?!\/)/, severity: "info", message: "Full lodash added (consider lodash-es or individual imports)" },
  { id: "heavy-jquery", pattern: /"jquery"/, severity: "info", message: "jQuery added (consider native DOM APIs)" },
];

function getExtension(filePath) {
  if (!filePath) return "";
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

/**
 * Check if any modified file in the diff is a frontend file
 */
export function hasFrontendFiles(diff) {
  if (!diff) return false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const ext = getExtension(line.slice(6));
      if (FRONTEND_EXTENSIONS.has(ext)) return true;
    }
  }
  return false;
}

/**
 * Extract added lines grouped by file from a unified diff
 */
function extractAddedLinesByFile(diff) {
  const results = [];
  let currentFile = null;
  let lineNum = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNum = match ? Number.parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNum += 1;
      results.push({ file: currentFile, line: lineNum, content: line.slice(1) });
    } else if (!line.startsWith("-")) {
      lineNum += 1;
    }
  }
  return results;
}

/**
 * Scan diff for frontend performance anti-patterns.
 * Returns { pass: boolean, violations: [...], skipped: boolean }
 */
export function scanPerfDiff(diff, config = {}) {
  if (!diff || typeof diff !== "string") {
    return { pass: true, violations: [], skipped: true };
  }

  if (!hasFrontendFiles(diff)) {
    return { pass: true, violations: [], skipped: true };
  }

  const customPatterns = Array.isArray(config?.guards?.perf?.patterns)
    ? config.guards.perf.patterns.map(p => ({
        id: p.id || "custom-perf",
        pattern: typeof p.pattern === "string" ? new RegExp(p.pattern, p.flags || "i") : p.pattern,
        severity: p.severity || "warning",
        message: p.message || "Custom perf pattern matched",
      }))
    : [];

  const allPatterns = [...PERF_PATTERNS, ...customPatterns];
  const addedLines = extractAddedLinesByFile(diff);
  const violations = [];

  for (const { file, line, content } of addedLines) {
    const ext = getExtension(file);
    const isFrontend = FRONTEND_EXTENSIONS.has(ext);
    const isPackageJson = file?.endsWith("package.json");

    if (isFrontend) {
      for (const { id, pattern, severity, message } of allPatterns) {
        if (pattern.test(content)) {
          violations.push({ id, severity, file, line, message, matchedContent: content.trim().slice(0, 200) });
        }
      }
    }

    if (isPackageJson) {
      for (const { id, pattern, severity, message } of HEAVY_DEPS) {
        if (pattern.test(content)) {
          violations.push({ id, severity, file, line, message, matchedContent: content.trim().slice(0, 200) });
        }
      }
    }
  }

  // perf-guard is advisory by default — only blocks on critical (none built-in are critical)
  const blockOnWarning = Boolean(config?.guards?.perf?.block_on_warning);
  const hasCritical = violations.some(v => v.severity === "critical");
  const hasWarning = violations.some(v => v.severity === "warning");
  const pass = !hasCritical && !(blockOnWarning && hasWarning);

  return { pass, violations, skipped: false };
}

export { PERF_PATTERNS, HEAVY_DEPS, FRONTEND_EXTENSIONS };
