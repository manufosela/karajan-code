/**
 * Deterministic compressors for Claude Code tool output (Grep, Read, Glob).
 * Consolidated from: grep.js, read.js, glob.js.
 */
import { stripAnsi, truncateLines, countTokens } from "./utils.js";

// ── Grep / ripgrep ───────────────────────────────────────────────────────────

const MAX_MATCHES_PER_FILE = 3;
const MAX_FILES = 15;

function looksLikeGrep(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const matchingLines = lines.filter((l) => /^[^\s:]+:\d+:/.test(l) || /^[^\s:]+:/.test(l));
  return matchingLines.length >= lines.length * 0.5;
}

function compactGrep(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
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
    result.push(...matches.slice(0, MAX_MATCHES_PER_FILE));
    if (matches.length > MAX_MATCHES_PER_FILE) {
      result.push(`  ... (${matches.length - MAX_MATCHES_PER_FILE} more matches in ${file})`);
    }
  }

  if (totalFiles > MAX_FILES) result.push(`\n... (${totalFiles - MAX_FILES} more files)`);
  result.push(`\nTotal: ${totalMatches} matches in ${totalFiles} files`);
  return result.join("\n");
}

// ── Read (file content) ──────────────────────────────────────────────────────

const READ_MAX_LINES = 200;
const READ_TOKEN_THRESHOLD = 2000;

function looksLikeRead(text) {
  if (countTokens(text) < READ_TOKEN_THRESHOLD) return false;
  const lines = text.split("\n");
  if (lines.length < 50) return false;
  return /^\s*\d+\t/.test(lines[0]) || /^(import |export |const |function |class |def |package )/.test(lines[0]);
}

function compactRead(text) {
  return truncateLines(text, READ_MAX_LINES);
}

// ── Glob (file listings) ────────────────────────────────────────────────────

const GLOB_MAX_FILES = 40;

function looksLikeGlob(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length < 5) return false;
  const pathLike = lines.filter((l) => /^[\w./-]+\.\w+$/.test(l.trim()) || /^\//.test(l.trim()));
  return pathLike.length >= lines.length * 0.6;
}

function compactGlob(text) {
  const clean = stripAnsi(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length <= GLOB_MAX_FILES) return clean;
  const shown = lines.slice(0, GLOB_MAX_FILES);
  shown.push(`\n... (${lines.length} total files, showing first ${GLOB_MAX_FILES})`);
  return shown.join("\n");
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const TOOL_COMPRESSORS = {
  Grep: { looksLike: looksLikeGrep, compact: compactGrep },
  Read: { looksLike: looksLikeRead, compact: compactRead },
  Glob: { looksLike: looksLikeGlob, compact: compactGlob }
};
