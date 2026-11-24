// HU-4835 (KJC-TSK-1730, épica KJC-PCS-0113): one deterministic rule, no model, for whether a
// reviewer finding cites something real: its file, its line and the code it quotes.

const SNIPPET_WINDOW = 3;
const PROTECTED_SEVERITIES = new Set(["critical"]);
const PROTECTED_CATEGORIES = new Set(["security"]);

/** Files and added line numbers (new side) of a unified diff: Map<path, Set<number>>. */
const addedLinesByFile = (diff) => {
  const files = new Map();
  let current = null;
  let next = 0;
  for (const row of String(diff ?? "").split("\n")) {
    if (row.startsWith("+++ ")) {
      const path = row.slice(4).replace(/^b\//, "");
      current = path === "/dev/null" ? null : path;
      if (current && !files.has(current)) files.set(current, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (!current || row.startsWith("--- ") || row.startsWith("\\")) continue;
    if (row.startsWith("+")) files.get(current).add(next++);
    else if (row.startsWith(" ")) next++;
  }
  return files;
};

const quotedSpans = (description) =>
  [...String(description ?? "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter(Boolean);

const toLines = (content) => {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const snippetHolds = (spans, text) => spans.length === 0 || spans.some((span) => text.includes(span));

const verdict = (finding, anchored, reason) => ({
  anchored,
  reason,
  protected: !anchored && (PROTECTED_CATEGORIES.has(finding.category) || PROTECTED_SEVERITIES.has(finding.severity)),
});

const hasLine = (line) => Number.isInteger(line);

const windowText = (lines, line) =>
  lines.slice(Math.max(0, line - 1 - SNIPPET_WINDOW), line + SNIPPET_WINDOW).join("\n");

/** In the diff: the cited line was added; without a line, one of the quoted spans sits on an added line. */
const isInDiff = (added, line, spans, lines) => {
  if (!added) return false;
  if (hasLine(line)) return added.has(line);
  return lines.some((text, index) => added.has(index + 1) && spans.some((span) => text.includes(span)));
};

/**
 * Does a reviewer finding hold? { anchored, reason, protected }.
 * reasons: whole-diff, in-diff, outside-diff, missing-file, missing-line, snippet-mismatch.
 * `protected` marks an unanchored security/critical finding: nobody downgrades it.
 */
export const anchorFinding = (finding, { diff, readFile }) => {
  if (!finding.file) return verdict(finding, true, "whole-diff");
  const content = readFile(finding.file);
  if (typeof content !== "string") return verdict(finding, false, "missing-file");
  const lines = toLines(content);
  const withLine = hasLine(finding.line);
  if (withLine && (finding.line < 1 || finding.line > lines.length)) return verdict(finding, false, "missing-line");
  const spans = quotedSpans(finding.description);
  const text = withLine ? windowText(lines, finding.line) : content;
  if (!snippetHolds(spans, text)) return verdict(finding, false, "snippet-mismatch");
  const inDiff = isInDiff(addedLinesByFile(diff).get(finding.file), finding.line, spans, lines);
  return verdict(finding, true, inDiff ? "in-diff" : "outside-diff");
};
