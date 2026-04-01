/**
 * Deterministic compression for glob/find/ls output.
 * Truncates long file listings while keeping count.
 */
import { stripAnsi, truncateLines } from "./utils.js";

const MAX_FILES_SHOWN = 40;

export function looksLike(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length < 5) return false;
  // Most lines look like file paths
  const pathLike = lines.filter((l) => /^[\w./-]+\.\w+$/.test(l.trim()) || /^\//.test(l.trim()));
  return pathLike.length >= lines.length * 0.6;
}

export function compact(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length <= MAX_FILES_SHOWN) return clean;

  const shown = lines.slice(0, MAX_FILES_SHOWN);
  shown.push(`\n... (${lines.length} total files, showing first ${MAX_FILES_SHOWN})`);
  return shown.join("\n");
}
