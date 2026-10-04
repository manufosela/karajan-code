/**
 * Rule inventory (KJC-TSK-0937, MDR-A, ADR 0016). Every rule written in the MD
 * files that govern a session, with a stable id, its literal text and where it
 * lives, so each one can get a gate and a deny can cite it.
 *
 * A rule is a line, outside code blocks, that carries a normative marker. The id
 * hashes the normalized text, so a rule keeps its id when it moves to another line.
 */
import { createHash } from "node:crypto";

const NORMATIVE = /\b(nunca|siempre|prohibido|obligatorio|jam[aá]s|never|always|must|forbidden|required|do not|don't)\b/i;

// Emphasis delimiters only: a marker opens after a blank and closes before one (or
// punctuation), so snake_case names and globs (docs/**/*.md) keep their characters.
const stripEmphasis = (text) => text
  .replaceAll(/(^|[\s(])\*\*(\S[^*]*)\*\*(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])__(\S[^_]*)__(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])\*(\S[^*]*)\*(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])_(\S[^_]*)_(?=[\s).,;:!?]|$)/g, "$1$2");

const HELD = ""; // private-use char: stands in for a code span while emphasis is stripped

/**
 * The text of a markdown line without its list marker, emphasis or code ticks.
 * What sits inside a code span is kept as written, whatever characters it holds.
 */
const plain = (line) => {
  const spans = [];
  const held = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replaceAll(/`([^`]*)`/g, (_m, code) => `${HELD}${spans.push(code) - 1}${HELD}`);
  return stripEmphasis(held)
    .replaceAll(new RegExp(`${HELD}(\\d+)${HELD}`, "g"), (_m, n) => spans[Number(n)])
    .replaceAll(/\s+/g, " ")
    .trim();
};

const ruleId = (text) => "R-" + createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 10);

/**
 * @param {string} markdown
 * @param {string} file
 * @returns {{id: string, text: string, file: string, line: number}[]}
 */
export function extractRules(markdown, file) {
  const rules = [];
  let fence = null; // the open code fence (``` or ~~~, any length), closed by one as long
  const lines = markdown.split("\n");
  // A memory file's YAML frontmatter is metadata, not rules.
  const frontmatterEnd = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  lines.forEach((raw, i) => {
    if (i <= frontmatterEnd) return;
    const mark = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
    if (mark && !fence) { fence = mark; return; }
    if (mark && mark[0] === fence[0] && mark.length >= fence.length && raw.trim() === mark) { fence = null; return; }
    if (fence || /^\s*#/.test(raw) || /^\s*\|/.test(raw)) return;
    const text = plain(raw);
    if (text && NORMATIVE.test(text)) rules.push({ id: ruleId(text), text, file, line: i + 1 });
  });
  return rules;
}
