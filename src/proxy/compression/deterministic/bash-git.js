/**
 * Deterministic compression for git CLI output.
 * Handles: git status, git diff, git log, git branch.
 */
import { stripAnsi, collapseWhitespace, truncateLines } from "./utils.js";

const GIT_PATTERNS = [
  /^On branch /m,
  /^(modified|deleted|new file|renamed):/m,
  /^Untracked files:/m,
  /^diff --git/m,
  /^commit [0-9a-f]{7,40}/m,
  /^(Changes to be committed|Changes not staged)/m,
  /^\* /m // git branch current branch marker
];

export function looksLike(text) {
  const clean = stripAnsi(text);
  return GIT_PATTERNS.some((p) => p.test(clean));
}

export function compact(text) {
  const clean = stripAnsi(text);

  // git status
  if (/^On branch /m.test(clean) || /Changes (to be committed|not staged)/m.test(clean)) {
    return compactStatus(clean);
  }
  // git diff
  if (/^diff --git/m.test(clean)) {
    return compactDiff(clean);
  }
  // git log
  if (/^commit [0-9a-f]{7,40}/m.test(clean)) {
    return compactLog(clean);
  }
  // git branch
  if (/^\* /m.test(clean) && clean.split("\n").every((l) => /^[\s*]/.test(l) || !l.trim())) {
    return compactBranch(clean);
  }
  return collapseWhitespace(clean);
}

function compactStatus(text) {
  const lines = text.split("\n");
  const kept = [];
  const branchLine = lines.find((l) => l.startsWith("On branch "));
  if (branchLine) kept.push(branchLine);

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^(modified|deleted|new file|renamed|both modified):/.test(trimmed) ||
      /^(Untracked files|Changes to be committed|Changes not staged)/.test(trimmed)
    ) {
      kept.push(trimmed);
    }
  }
  return kept.join("\n") || text;
}

function compactDiff(text) {
  const files = text.split(/(?=^diff --git)/m);
  const summaries = [];
  for (const file of files) {
    if (!file.trim()) continue;
    const header = file.match(/^diff --git a\/(.+?) b\/(.+)/m);
    const fname = header ? header[2] : "unknown";
    const additions = (file.match(/^\+(?!\+\+)/gm) || []).length;
    const deletions = (file.match(/^-(?!--)/gm) || []).length;
    const hunkHeaders = file.match(/^@@.*@@.*$/gm) || [];
    summaries.push(`${fname}: +${additions}/-${deletions} (${hunkHeaders.length} hunks)`);

    // Keep first few hunk headers for context
    for (const h of hunkHeaders.slice(0, 3)) {
      summaries.push(`  ${h.trim()}`);
    }
  }
  return `git diff summary (${files.filter((f) => f.trim()).length} files):\n${summaries.join("\n")}`;
}

function compactLog(text) {
  const entries = text.split(/(?=^commit )/m).filter((e) => e.trim());
  const lines = [];
  for (const entry of entries) {
    const hashMatch = entry.match(/^commit ([0-9a-f]{7})/);
    const msgMatch = entry.match(/^\s{4}(.+)/m);
    const hash = hashMatch ? hashMatch[1] : "???????";
    const msg = msgMatch ? msgMatch[1].trim() : "(no message)";
    lines.push(`${hash} ${msg}`);
  }
  return truncateLines(lines.join("\n"), 30);
}

function compactBranch(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= 20) return lines.map((l) => l.trim()).join("\n");
  const current = lines.find((l) => l.startsWith("*"));
  const count = lines.length;
  return `${current ? current.trim() : "(detached)"}\n... (${count} branches total)`;
}
