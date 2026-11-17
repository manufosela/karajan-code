// HU-4547 — Swift chunker, regex only (no grammar). Emits one chunk per
// top-level declaration (column 0): class, struct, enum, protocol, extension,
// actor, func. Members are indented, so they stay inside their parent chunk.
// With no match the shared window chunker (spanChunks without marks) applies.
import { spanChunks } from "./chunk-span.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const MODIFIERS = "(?:public|private|fileprivate|internal|open|final|indirect|nonisolated|package)";
const TOP_RE = new RegExp(
  `^(?:@\\w+(?:\\([^)\\n]*\\))?[ \\t]+)*(?:${MODIFIERS}[ \\t]+)*(?:class|struct|enum|protocol|extension|actor|func)[ \\t]+([A-Za-z_]\\w*)`,
  "gm",
);

function marksViaRegex(text) {
  const marks = [];
  for (const m of text.matchAll(TOP_RE)) marks.push({ idx: m.index, symbol: m[1] });
  return marks;
}

export function chunkSwift(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const source = typeof text === "string" ? text : "";
  return spanChunks(source, marksViaRegex(source), { path, language: "swift", limit, overlap });
}
