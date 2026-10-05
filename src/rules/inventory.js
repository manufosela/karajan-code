/**
 * Rule inventory (KJC-TSK-0937, MDR-A, ADR 0016). Every rule written in the MD
 * files that govern a session, with a stable id, its literal text and where it
 * lives, so each one can get a gate and a deny can cite it.
 *
 * A rule is a markdown block (a list item with the lines that continue it, or a
 * paragraph), outside code blocks, that carries a normative marker. The id hashes
 * the normalized text, so a rule keeps its id when it moves or is wrapped anew.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NORMATIVE = /\b(nunca|siempre|prohibido|obligatorio|jam[aá]s|never|always|must|forbidden|required|do not|don't)\b/i;

// Emphasis delimiters only: a marker opens after a blank and closes before one (or
// punctuation), so snake_case names and globs (docs/**/*.md) keep their characters.
const stripEmphasis = (text) => text
  .replaceAll(/(^|[\s(])\*\*(\S[^*]*)\*\*(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])__(\S[^_]*)__(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])\*(\S[^*]*)\*(?=[\s).,;:!?]|$)/g, "$1$2")
  .replaceAll(/(^|[\s(])_(\S[^_]*)_(?=[\s).,;:!?]|$)/g, "$1$2");

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

const HELD =""; // private-use char: stands in for a code span while emphasis is stripped

/**
 * The text of a markdown line without its list marker, emphasis or code ticks.
 * What sits inside a code span is kept as written, whatever characters it holds.
 */
const plain = (line) => {
  const spans = [];
  const held = line
    .replace(LIST_ITEM, "")
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
  let comment = false; // inside an HTML comment that has not closed yet
  let block = null; // the list item or paragraph being read: { line, parts }
  const flush = () => {
    const text = block ? plain(block.parts.join(" ")) : "";
    if (text && NORMATIVE.test(text)) rules.push({ id: ruleId(text), text, file, line: block.line });
    block = null;
  };
  const lines = markdown.split("\n");
  // A memory file's YAML frontmatter is metadata, not rules.
  const frontmatterEnd = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  lines.forEach((raw, i) => {
    if (i <= frontmatterEnd) return;
    const mark = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
    if (mark && !fence) { flush(); fence = mark; return; }
    if (mark && mark[0] === fence[0] && mark.length >= fence.length && raw.trim() === mark) { fence = null; return; }
    if (fence) return;
    if (comment || /^\s*<!--/.test(raw)) { flush(); comment = !raw.includes("-->"); return; }
    if (!raw.trim() || /^\s*#/.test(raw) || /^\s*\|/.test(raw)) { flush(); return; }
    // KJC-BUG-0271: the unit is the markdown block. A list marker opens a new
    // one; any other line continues the block it follows (a wrapped rule).
    if (LIST_ITEM.test(raw)) flush();
    block ??= { line: i + 1, parts: [] };
    block.parts.push(raw.trim());
  });
  flush();
  return rules;
}

/**
 * The MD files that govern a session in projectDir (KJC-TSK-0942): its CLAUDE.md
 * and AGENTS.md, the global ~/.claude/CLAUDE.md and the project's feedback memories.
 * @param {string} projectDir
 * @param {{home?: string}} [opts]
 */
export function ruleSources(projectDir, { home = os.homedir() } = {}) {
  // Claude Code names a project's folder after its path, every non-alphanumeric char as "-".
  const memory = path.join(home, ".claude", "projects", path.resolve(projectDir).replaceAll(/[^A-Za-z0-9]/g, "-"), "memory");
  let feedback = [];
  try {
    feedback = fs.readdirSync(memory).filter((f) => /^feedback_.*\.md$/.test(f)).sort().map((f) => path.join(memory, f));
  } catch { /* no memories for this project */ }
  return [
    path.join(projectDir, "CLAUDE.md"),
    path.join(projectDir, "AGENTS.md"),
    path.join(home, ".claude", "CLAUDE.md"),
    ...feedback,
  ].filter((f) => fs.existsSync(f));
}

/** Whether an MD file is part of the project, and so as public as the repo is. */
export const inProject = (file, projectDir) => {
  const rel = path.relative(projectDir, file);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A source as a rules file can carry it: from the project's root, or from `~`. */
export const shownSource = (file, projectDir, home = os.homedir()) => {
  if (inProject(file, projectDir)) return path.relative(projectDir, file);
  return inProject(file, home) ? path.join("~", path.relative(home, file)) : file;
};

/** Every rule of every governing MD file, in source order. */
export function listRules(projectDir, opts = {}) {
  return ruleSources(projectDir, opts).flatMap((file) => extractRules(fs.readFileSync(file, "utf8"), file));
}
