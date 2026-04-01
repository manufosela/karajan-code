/**
 * Deterministic compression for build tool output.
 * Handles: tsc, eslint, prettier, next build, webpack, vite build.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const BUILD_PATTERNS = [
  /error TS\d+:/,
  /\d+ errors?/i,
  /\d+ warnings?/i,
  /eslint/i,
  /prettier/i,
  /webpack/i,
  /✔|Built in|compiled/i,
  /Module Error|SyntaxError|TypeError/,
  /next build|vite build/i
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return BUILD_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n");

  // Collect error/warning lines and summary lines
  const errors = [];
  const warnings = [];
  const summaries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/error TS\d+:|Error:|SyntaxError:|TypeError:|Module Error/i.test(trimmed)) {
      errors.push(trimmed);
    } else if (/warning|warn\b/i.test(trimmed) && !/node_modules/.test(trimmed)) {
      warnings.push(trimmed);
    } else if (/\d+ errors?|\d+ warnings?|compiled|Built in|✔|Found \d+/i.test(trimmed)) {
      summaries.push(trimmed);
    }
  }

  const parts = [];
  if (errors.length) {
    parts.push(`Errors (${errors.length}):\n${truncateLines(errors.join("\n"), 20)}`);
  }
  if (warnings.length) {
    parts.push(`Warnings (${warnings.length}):\n${truncateLines(warnings.join("\n"), 10)}`);
  }
  if (summaries.length) {
    parts.push(summaries.join("\n"));
  }

  if (parts.length) return parts.join("\n\n");

  return truncateLines(collapseWhitespace(clean), 40);
}
