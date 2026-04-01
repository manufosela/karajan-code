/**
 * Deterministic compression for file read output.
 * Truncates very long file contents while preserving structure.
 */
import { truncateLines, countTokens } from "./utils.js";

const MAX_LINES = 200;
const TOKEN_THRESHOLD = 2000;

export function looksLike(text) {
  // Read output is generic text; we use this as a fallback for very long content
  // that looks like source code or structured data.
  if (countTokens(text) < TOKEN_THRESHOLD) return false;
  const lines = text.split("\n");
  if (lines.length < 50) return false;
  // Heuristic: numbered lines (cat -n style) or code-like content
  return /^\s*\d+\t/.test(lines[0]) || /^(import |export |const |function |class |def |package )/.test(lines[0]);
}

export function compact(text) {
  return truncateLines(text, MAX_LINES);
}
