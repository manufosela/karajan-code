/**
 * Deterministic compression for grep/ripgrep output.
 * Collapses repetitive results, keeps first N per file + total count.
 */
import { stripAnsi, truncateLines } from "./utils.js";

const MAX_MATCHES_PER_FILE = 3;
const MAX_FILES = 15;

export function looksLike(text) {
  const clean = stripAnsi(text);
  // grep-style output: file:line:content or file:content
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const matchingLines = lines.filter((l) => /^[^\s:]+:\d+:/.test(l) || /^[^\s:]+:/.test(l));
  return matchingLines.length >= lines.length * 0.5;
}

export function compact(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());

  // Group by file
  const byFile = new Map();
  for (const line of lines) {
    const match = line.match(/^([^\s:]+):/);
    const file = match ? match[1] : "__other__";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(line);
  }

  const totalFiles = byFile.size;
  const totalMatches = lines.length;
  const result = [];
  let fileCount = 0;

  for (const [file, matches] of byFile) {
    if (fileCount >= MAX_FILES) break;
    fileCount++;
    const shown = matches.slice(0, MAX_MATCHES_PER_FILE);
    result.push(...shown);
    if (matches.length > MAX_MATCHES_PER_FILE) {
      result.push(`  ... (${matches.length - MAX_MATCHES_PER_FILE} more matches in ${file})`);
    }
  }

  if (totalFiles > MAX_FILES) {
    result.push(`\n... (${totalFiles - MAX_FILES} more files)`);
  }
  result.push(`\nTotal: ${totalMatches} matches in ${totalFiles} files`);

  return result.join("\n");
}
