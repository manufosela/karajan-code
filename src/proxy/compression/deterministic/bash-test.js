/**
 * Deterministic compression for test runner output.
 * Handles: vitest, jest, mocha, playwright, pytest, cargo test, go test.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const TEST_PATTERNS = [
  /Tests?\s+\d+\s+(passed|failed)/i,
  /✓|✗|✘|PASS|FAIL/,
  /Test Suites?:/,
  /test result:/i,
  /FAILED|PASSED|ERROR/,
  /vitest|jest|mocha|playwright|pytest|cargo test|go test/i,
  /\d+ passing/,
  /\d+ failing/
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return TEST_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);

  // Extract summary line if present
  const summaryPatterns = [
    /Tests?\s+\d+\s+(passed|failed).*/gi,
    /Test Suites?:.*$/gm,
    /\d+ passing.*$/gm,
    /\d+ failing.*$/gm,
    /test result:.*$/gim,
    /Tests:.*\d+ total$/gm
  ];

  const summaries = [];
  for (const p of summaryPatterns) {
    const matches = clean.match(p);
    if (matches) summaries.push(...matches.map((m) => m.trim()));
  }

  // Extract failed test details (name + error)
  const failures = [];
  const failBlocks = clean.split(/(?=(?:FAIL|✗|✘|×)\s)/);
  for (const block of failBlocks) {
    if (/^(?:FAIL|✗|✘|×)\s/.test(block)) {
      failures.push(truncateLines(block.trim(), 8));
    }
  }

  const parts = [];
  if (summaries.length) parts.push(summaries.join("\n"));
  if (failures.length) {
    parts.push(`Failed tests:\n${failures.join("\n---\n")}`);
  }

  if (parts.length) return parts.join("\n\n");

  // Fallback: collapse and truncate
  return truncateLines(collapseWhitespace(clean), 50);
}
