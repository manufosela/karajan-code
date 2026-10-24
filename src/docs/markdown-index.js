/**
 * KJC-TSK-1183 — Long markdown documents read by index: the headings first, then only the
 * sections a task needs, each one whole and exactly as it is in the file. The headings are the
 * index, so there is nothing extra to keep in sync. Independent of any spec kit's format.
 */

// ATX headings only: up to three spaces, `#` to `######`, a space, the title, an optional closing run of `#`.
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
// A fence opens with three or more of one character; it closes with the same character, a run at
// least as long, and nothing else on the line (CommonMark): ```` is not closed by ```.
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

export class UnknownHeadingError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnknownHeadingError";
  }
}

/** The headings of the document, with level and 1-based line; a heading inside a fenced code block is text. */
export function indexMarkdown(text) {
  const headings = [];
  let fence = null; // the opening run, e.g. "````", while inside a code block
  text.split("\n").forEach((raw, i) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (fence !== null) {
      const c = FENCE_CLOSE.exec(line);
      if (c && c[1][0] === fence[0] && c[1].length >= fence.length) fence = null;
      return;
    }
    const o = FENCE_OPEN.exec(line);
    if (o) {
      fence = o[1];
      return;
    }
    const m = HEADING.exec(line);
    if (m) headings.push({ level: m[1].length, title: m[2], line: i + 1 });
  });
  return headings;
}

/**
 * The section under `title`: its heading line and everything up to the next heading of the same
 * or a higher level, as the file has it. Exact title first, case-insensitive as a fallback; with
 * duplicates the first wins and the others are named by line. An unknown title is an error that
 * lists the headings, never an empty section.
 */
export function sectionOf(text, title) {
  const headings = indexMarkdown(text);
  let hits = headings.filter((h) => h.title === title);
  if (hits.length === 0) hits = headings.filter((h) => h.title.toLowerCase() === title.toLowerCase());
  if (hits.length === 0) {
    const available = headings.map((h) => h.title).join(", ") || "none";
    throw new UnknownHeadingError(`"${title}" is not a heading of this document; the headings are: ${available}`);
  }
  const [first, ...others] = hits;
  const lines = text.split("\n");
  const next = headings.find((h) => h.line > first.line && h.level <= first.level);
  const body = next ? `${lines.slice(first.line - 1, next.line - 1).join("\n")}\n` : lines.slice(first.line - 1).join("\n");
  return { level: first.level, title: first.title, line: first.line, text: body, ...(others.length ? { duplicates: others.map((h) => h.line) } : {}) };
}
