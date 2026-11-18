// HU-4546 — Kotlin chunker (regex, no grammar). One chunk per top-level
// declaration, named after the symbol. Only column-0 declarations count, so
// members and nested classes stay inside their parent's chunk. No match falls
// back to window chunks (spanChunks with no marks); it never throws.
import { spanChunks } from "./chunk-span.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const MODS = "(?:(?:public|private|internal|protected|abstract|open|final|sealed|data|enum|annotation|inner|value|inline|external|suspend|tailrec|operator|infix|expect|actual|fun)\\s+)*";
const TOP_RE = new RegExp(`^${MODS}(?:(?:class|interface|object)\\s+(\\w+)|fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>?,\\s]+\\.)?(\\w+)\\s*\\()`, "gm");

function marksOf(text) {
  const marks = [];
  TOP_RE.lastIndex = 0;
  let m;
  while ((m = TOP_RE.exec(text)) !== null) marks.push({ idx: m.index, symbol: m[1] ?? m[2] });
  return marks;
}

export function chunkKotlin(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const src = typeof text === "string" ? text : "";
  return spanChunks(src, marksOf(src), { path, language: "kotlin", limit, overlap });
}
