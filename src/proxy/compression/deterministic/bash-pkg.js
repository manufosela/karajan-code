/**
 * Deterministic compression for package manager output.
 * Handles: npm/yarn/pnpm install, npm list, npm outdated.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const PKG_PATTERNS = [
  /added \d+ packages?/i,
  /npm warn|npm error/i,
  /packages? in \d/,
  /├──|└──|│/,
  /\d+ vulnerabilities/i,
  /npm outdated/i,
  /Current\s+Wanted\s+Latest/i
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return PKG_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);

  // npm install summary
  if (/added \d+ packages?/i.test(clean)) {
    const lines = clean.split("\n");
    const kept = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/added \d+ packages?/i.test(trimmed) || /vulnerabilit/i.test(trimmed)) {
        kept.push(trimmed);
      }
    }
    return kept.join("\n") || clean;
  }

  // npm list — truncate tree
  if (/├──|└──/.test(clean)) {
    return truncateLines(clean, 25);
  }

  // npm outdated — compact table
  if (/Current\s+Wanted\s+Latest/i.test(clean)) {
    return truncateLines(collapseWhitespace(clean), 20);
  }

  return truncateLines(collapseWhitespace(clean), 30);
}
