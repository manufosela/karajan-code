/**
 * KJC-BUG-0235 — are the lines a diff ADDS only comments? A cleanup deletes
 * code and corrects the comments that were left lying about it; those added
 * lines carry no behavior to test. Decided by scanning the resulting file, not
 * by a line's first characters: " * factor" can continue a product. Strings are
 * kept as code, so a docstring or a `//` inside a string is never a comment.
 * An unknown syntax is not judged: everything counts as code (conservative).
 */
import { extname } from "node:path";

// JSX/TSX and PHP are out: a `//` in a JSX text child or outside `<?php` is
// rendered content. JSX inside a .js/.ts file is detected below.
const C_STYLE = new Set([".js", ".mjs", ".cjs", ".ts", ".java", ".cs", ".go", ".kt", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".rs", ".scala"]);
// Shell and Ruby are left out on purpose: a `#` line inside a heredoc is
// content, not a comment, and this scanner does not parse heredocs.
const HASH_STYLE = new Set([".py"]);
const OPENER_AFTER = new Set([";", "{", "}", "(", ")", ",", "=", ":", "?", "!", "&", "|"]);

/** @returns {Set<number>|null} 1-based lines holding code, or null for an unknown syntax */
export function codeLines(content, file) {
  const ext = extname(file).toLowerCase();
  const cStyle = C_STYLE.has(ext);
  if (!cStyle && !HASH_STYLE.has(ext)) return null;
  const lines = new Set();
  let line = 1;
  let state = "code"; // code | line | block | string
  let quote = "";
  const s = String(content);
  let step; // characters consumed by the current iteration (set in the body)
  let prev = ""; // last non-space character seen in code on this line
  let word = ""; // identifier being read in code
  let lastWord = ""; // last complete identifier in code
  for (let i = 0; i < s.length; i += step) {
    const c = s[i];
    const next = s[i + 1];
    step = 1;
    if (c === "\n") prev = "";
    if (c === "\n") {
      line++;
      if (state === "line") state = "code";
      // A line inside a multi-line string is part of its value, even if blank.
      if (state === "string") lines.add(line);
    } else if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; step = 2; }
    } else if (state === "string") {
      lines.add(line);
      if (c === "\\") {
        // An escaped newline continues the string on the next physical line: count it.
        if (next === "\n") { line++; lines.add(line); }
        step = 2;
      } else if (c === quote) {
        state = "code";
      }
    } else if (state === "code") {
      // A comment opens only where one can: line start or after a separator.
      // After `\`, `[` or an identifier a slash may belong to a regex literal
      // (/a\/*b/, /[/*]/), so it is taken as code: in doubt, code.
      const canOpen = prev === "" || OPENER_AFTER.has(prev);
      if (/[\w$]/.test(c)) word += c;
      else if (word) { lastWord = word; word = ""; }
      // A tag where an expression starts (`= <div>`, `return <App />`) is JSX:
      // its text children are rendered, so this file is not judged.
      if (cStyle && c === "<" && /[A-Za-z/>]/.test(next ?? "") && (canOpen || lastWord === "return")) return null;
      if (cStyle && canOpen && c === "/" && next === "/") state = "line";
      else if (cStyle && canOpen && c === "/" && next === "*") { state = "block"; step = 2; }
      else if (!cStyle && c === "#") state = "line";
      else if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; lines.add(line); }
      else if (!/\s/.test(c)) lines.add(line);
      if (state === "code" && !/\s/.test(c)) prev = c;
    }
  }
  return lines;
}

const COMMENT_START = /^(\/\/|\/\*|\*|#)/;

/**
 * Every added line (1-based, in the resulting file) is a comment or blank.
 * Two checks must agree: the scanner says no code on the line AND the line
 * itself starts like a comment (or is blank). The second one is a net against
 * a scanner mistake, and it costs a knowingly accepted false negative: a block
 * comment continuation without a leading `*` counts as code. Agreed criterion
 * (KJC-BUG-0235): better a cleanup that still asks for tests than code let through.
 */
export function addedAreCommentsOnly(content, addedLines, file) {
  const code = codeLines(content, file);
  if (!code) return false;
  const text = String(content).split("\n");
  return [...addedLines].every((n) => {
    const t = (text[n - 1] ?? "").trim();
    return !code.has(n) && (t === "" || COMMENT_START.test(t));
  });
}
