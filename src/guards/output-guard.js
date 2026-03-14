import { runCommand } from "../utils/process.js";

// Built-in destructive patterns
const DESTRUCTIVE_PATTERNS = [
  { id: "rm-rf", pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*-[a-zA-Z]*r/, severity: "critical", message: "Recursive file deletion detected" },
  { id: "drop-table", pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, severity: "critical", message: "SQL destructive operation detected" },
  { id: "git-reset-hard", pattern: /git\s+reset\s+--hard/i, severity: "critical", message: "Hard git reset detected" },
  { id: "git-push-force", pattern: /git\s+push\s+.*--force/i, severity: "critical", message: "Force push detected" },
  { id: "truncate-table", pattern: /TRUNCATE\s+TABLE/i, severity: "critical", message: "SQL truncate detected" },
  { id: "format-disk", pattern: /mkfs\.|fdisk|dd\s+if=/, severity: "critical", message: "Disk format operation detected" },
];

// Built-in credential patterns
const CREDENTIAL_PATTERNS = [
  { id: "aws-key", pattern: /AKIA[0-9A-Z]{16}/, severity: "critical", message: "AWS access key exposed" },
  { id: "private-key", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, severity: "critical", message: "Private key exposed" },
  { id: "generic-secret", pattern: /(password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/i, severity: "warning", message: "Potential secret/credential exposed" },
  { id: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/, severity: "critical", message: "GitHub token exposed" },
  { id: "npm-token", pattern: /npm_[A-Za-z0-9]{36,}/, severity: "critical", message: "npm token exposed" },
];

// Default protected files (block if these appear in added/modified lines)
const DEFAULT_PROTECTED_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  "serviceAccountKey.json",
  "credentials.json",
];

export function compilePatterns(configGuards) {
  const customPatterns = Array.isArray(configGuards?.output?.patterns)
    ? configGuards.output.patterns.map(p => ({
        id: p.id || "custom",
        pattern: typeof p.pattern === "string" ? new RegExp(p.pattern, p.flags || "") : p.pattern,
        severity: p.severity || "warning",
        message: p.message || "Custom pattern matched",
      }))
    : [];

  return [...DESTRUCTIVE_PATTERNS, ...CREDENTIAL_PATTERNS, ...customPatterns];
}

export function compileProtectedFiles(configGuards) {
  const custom = Array.isArray(configGuards?.output?.protected_files)
    ? configGuards.output.protected_files
    : [];
  return [...new Set([...DEFAULT_PROTECTED_FILES, ...custom])];
}

/**
 * Parse a unified diff to extract only added lines (lines starting with +, not ++)
 */
export function extractAddedLines(diff) {
  if (!diff) return [];
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
 * Check if any modified files are in the protected list
 */
export function checkProtectedFiles(diff, protectedFiles) {
  const violations = [];
  const modifiedFiles = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      modifiedFiles.push(line.slice(6));
    }
  }

  for (const file of modifiedFiles) {
    const basename = file.split("/").pop();
    if (protectedFiles.some(pf => file === pf || file.endsWith(`/${pf}`) || basename === pf)) {
      violations.push({
        id: "protected-file",
        severity: "critical",
        file,
        line: 0,
        message: `Protected file modified: ${file}`,
        matchedContent: "",
      });
    }
  }

  return violations;
}

/**
 * Scan a diff for pattern violations.
 * Returns { pass: boolean, violations: Array<{id, severity, file, line, message, matchedContent}> }
 */
export function scanDiff(diff, config = {}) {
  if (!diff || typeof diff !== "string") {
    return { pass: true, violations: [] };
  }

  const configGuards = config?.guards || {};
  const patterns = compilePatterns(configGuards);
  const protectedFiles = compileProtectedFiles(configGuards);
  const addedLines = extractAddedLines(diff);
  const violations = [];

  // Check patterns against added lines
  for (const { file, line, content } of addedLines) {
    for (const { id, pattern, severity, message } of patterns) {
      if (pattern.test(content)) {
        violations.push({ id, severity, file, line, message, matchedContent: content.trim().slice(0, 200) });
      }
    }
  }

  // Check protected files
  violations.push(...checkProtectedFiles(diff, protectedFiles));

  const hasCritical = violations.some(v => v.severity === "critical");
  return { pass: !hasCritical, violations };
}

/**
 * Run output guard on the current git diff.
 * This is the main entry point for the pipeline integration.
 */
export async function runOutputGuard(config = {}, baseBranch = "main") {
  const diffResult = await runCommand("git", ["diff", `origin/${baseBranch}...HEAD`]);
  if (diffResult.exitCode !== 0) {
    // Fallback: diff against HEAD~1
    const fallback = await runCommand("git", ["diff", "HEAD~1"]);
    if (fallback.exitCode !== 0) {
      return { pass: true, violations: [], error: "Could not generate diff" };
    }
    return scanDiff(fallback.stdout, config);
  }
  return scanDiff(diffResult.stdout, config);
}

export { DESTRUCTIVE_PATTERNS, CREDENTIAL_PATTERNS, DEFAULT_PROTECTED_FILES };
