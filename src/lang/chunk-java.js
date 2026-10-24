// KJC-PCS-0052 PR-B.2.5 — Java chunker (tree-sitter + regex fallback).
// Walker 2 niveles: top-level emite class/interface/enum/record; segundo pase
// desciende al body por method_declaration / constructor_declaration. Symbol
// sin prefijar (coherente con chunk-go), el RAG ya lleva contexto del fichero.

import { getLoaded, loadLanguage } from "./tree-sitter-loader.js";
import { spanChunks } from "./chunk-span.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const CONTAINER_KINDS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
]);
const MEMBER_KINDS = new Set([
  "method_declaration",
  "constructor_declaration",
]);
const TOP_RE = /^[ \t]*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/gm;

export async function prepareJava() {
  return loadLanguage("java");
}

function nameOf(node) {
  const n = node.childForFieldName("name");
  return n ? n.text : null;
}

function marksViaAST(text) {
  const entry = getLoaded("java");
  if (!entry) return null;
  let tree;
  try { tree = entry.parser.parse(text); } catch { return null; }
  const marks = [];
  for (const child of tree.rootNode.namedChildren) {
    if (!CONTAINER_KINDS.has(child.type)) continue;
    const className = nameOf(child);
    if (className) marks.push({ idx: child.startIndex, symbol: className });
    const body = child.childForFieldName("body");
    if (!body) continue;
    for (const m of body.namedChildren) {
      if (!MEMBER_KINDS.has(m.type)) continue;
      const memberName = nameOf(m);
      // KJC-TSK-1171: a member knows its class (by name); the chunk says both.
      if (memberName) marks.push({ idx: m.startIndex, symbol: memberName, parent: className });
    }
  }
  marks.sort((a, b) => a.idx - b.idx);
  return marks;
}

function marksViaRegex(text) {
  const marks = [];
  TOP_RE.lastIndex = 0;
  let m;
  while ((m = TOP_RE.exec(text)) !== null) marks.push({ idx: m.index, symbol: m[2] });
  return marks;
}

export function chunkJava(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  return spanChunks(text, marksViaAST(text) ?? marksViaRegex(text), { path, language: "java", limit, overlap });
}
