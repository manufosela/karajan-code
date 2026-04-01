/**
 * Shared utilities for deterministic compression.
 */

/** Strip ANSI escape sequences (colors, bold, etc.) */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/** Collapse consecutive whitespace (spaces/tabs) into a single space per line. */
export function collapseWhitespace(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Keep at most `max` lines, appending a truncation note. */
export function truncateLines(text, max = 100) {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  const kept = lines.slice(0, max);
  kept.push(`... (${lines.length - max} more lines truncated)`);
  return kept.join("\n");
}

/** Rough token estimate: chars / 4. */
export function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
