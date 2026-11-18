// HU-4548 — PHP chunker (regex, no grammar). One chunk per top-level
// class/interface/trait/enum/function, named after the symbol. Anchored at
// column 0 so methods and closures are not marks. With no marks (or odd
// input) spanChunks falls back to plain window chunks; it never throws.
import { spanChunks } from "./chunk-span.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const TOP_RE = /^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum|function)\s+&?\s*([A-Za-z_\x80-￿][\w\x80-￿]*)/gm;

function marksOf(text) {
  const marks = [];
  for (const m of text.matchAll(TOP_RE)) marks.push({ idx: m.index, symbol: m[1] });
  return marks;
}

export function chunkPhp(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const src = typeof text === "string" ? text : "";
  return spanChunks(src, marksOf(src), { path, language: "php", limit, overlap });
}
