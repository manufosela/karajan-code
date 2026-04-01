/**
 * Deterministic compression for miscellaneous Bash output.
 * Handles: curl/wget, gh CLI, npx, general long output.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const MISC_PATTERNS = [
  /HTTP\/[\d.]+\s+\d{3}/,
  /curl:|wget:/i,
  /gh (pr|issue|repo|release)/i,
  /npx:/i
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return MISC_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);

  // curl/wget — keep status + relevant headers
  if (/HTTP\/[\d.]+\s+\d{3}/.test(clean)) {
    return compactHttp(clean);
  }

  // gh CLI — compact lists
  if (/gh (pr|issue|repo|release)/i.test(clean)) {
    return truncateLines(collapseWhitespace(clean), 20);
  }

  return truncateLines(collapseWhitespace(clean), 40);
}

function compactHttp(text) {
  const lines = text.split("\n");
  const kept = [];
  for (const line of lines) {
    if (
      /HTTP\/[\d.]+\s+\d{3}/.test(line) ||
      /^(content-type|location|x-[-\w]+|authorization):/i.test(line.trim())
    ) {
      kept.push(line.trim());
    }
  }
  // Also keep body, truncated
  const bodyStart = text.indexOf("\r\n\r\n");
  if (bodyStart > -1) {
    const body = text.slice(bodyStart + 4).trim();
    if (body) kept.push(truncateLines(body, 20));
  }
  return kept.join("\n") || truncateLines(collapseWhitespace(text), 30);
}
