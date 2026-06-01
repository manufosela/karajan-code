// KJC-PCS-0052 PR-B.2.5 — Java chunker (tree-sitter + regex fallback).
// Walker 2 niveles: top-level emite class/interface/enum/record; segundo pase
// desciende al body por method_declaration / constructor_declaration. Symbol
// sin prefijar (coherente con chunk-go), el RAG ya lleva contexto del fichero.

import { getLoaded, loadLanguage } from "./tree-sitter-loader.js";

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

function windowText(text, limit, overlap) {
  if (text.length <= limit) return [text];
  const step = Math.max(1, limit - overlap);
  const out = [];
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + limit));
    if (i + limit >= text.length) break;
  }
  return out;
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
    const s = nameOf(child);
    if (s) marks.push({ idx: child.startIndex, symbol: s });
    const body = child.childForFieldName("body");
    if (!body) continue;
    for (const m of body.namedChildren) {
      if (!MEMBER_KINDS.has(m.type)) continue;
      const ms = nameOf(m);
      if (ms) marks.push({ idx: m.startIndex, symbol: ms });
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
  const marks = marksViaAST(text) ?? marksViaRegex(text);
  if (marks.length === 0) {
    return windowText(text, limit, overlap).map((piece) => ({
      text: piece,
      metadata: { source: path, kind: "code", symbol: null, language: "java" },
    }));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(start, end);
    for (const piece of windowText(body, limit, overlap)) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: marks[i].symbol, language: "java" } });
    }
  }
  return out;
}
