// KJC-TSK-1183 — Roles read long documents by index. Over the limit, a document reaches the prompt
// as its preamble plus its headings and the command that fetches one section whole; under it, or
// without headings to index, it travels as it is.
import { indexMarkdown } from "./markdown-index.js";

export const DEFAULT_INDEX_FIRST_BYTES = 12000;
const PREAMBLE_MAX = 1500;
const shellQuote = (s) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : ["'", s.replaceAll("'", String.raw`'\''`), "'"].join(""));

/**
 * What the agent reads instead of the whole document, or null when the whole fits or there is
 * nothing to index (fewer than two headings: a single one covers it all).
 * @param {{ path: string, text: string, limit?: number }} doc
 */
export function indexFirstView({ path, text, limit = DEFAULT_INDEX_FIRST_BYTES }) {
  if (!Number.isInteger(limit) || limit <= 0 || text.length <= limit) return null;
  const headings = indexMarkdown(text);
  if (headings.length < 2) return null;
  const preamble = text.split("\n").slice(0, headings[1].line - 1).join("\n").trim().slice(0, PREAMBLE_MAX);
  const index = headings.map((h) => `${"  ".repeat(h.level - 1)}- ${h.title}`).join("\n");
  const file = shellQuote(path);
  return [
    preamble,
    "",
    `_This document is ${text.length} characters, over the ${limit} read-whole limit, so it is read by index. Its headings:_`,
    "",
    index,
    "",
    `Read a section whole only when the task needs it: \`kj doc section ${file} "<heading>"\` (the index again: \`kj doc index ${file}\`).`,
  ].join("\n");
}
