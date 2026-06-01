// KJC-PCS-0052 PR-B.2.3 — Go source chunker (tree-sitter + regex fallback).
// Mismo contrato síncrono que chunk-rust: AST si el caller awaited
// `prepareGo()` antes, regex si no. Top-level: func / method / type.
//
// `method_declaration` (con receiver) y `function_declaration` se tratan
// igual — symbol es el nombre, sin componer "Recv.Method" (coherente con
// Python: del scope se ocupa la búsqueda semántica, no el chunk).
// `type_declaration` contiene type_spec(s); usamos el primero como symbol.

import { getLoaded, loadLanguage } from "./tree-sitter-loader.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const NAMED_KINDS = new Set([
  "function_declaration",
  "method_declaration",
]);
const TOP_RE = /^(?:func(?:\s+\([^)]+\))?|type)\s+([A-Za-z_]\w*)/gm;

export async function prepareGo() {
  return loadLanguage("go");
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

function symbolForType(node) {
  for (const spec of node.namedChildren) {
    if (spec.type === "type_spec" || spec.type === "type_alias") {
      const nameNode = spec.childForFieldName("name");
      if (nameNode) return nameNode.text;
    }
  }
  return null;
}

function marksViaAST(text) {
  const entry = getLoaded("go");
  if (!entry) return null;
  let tree;
  try {
    tree = entry.parser.parse(text);
  } catch {
    return null;
  }
  const marks = [];
  for (const child of tree.rootNode.namedChildren) {
    let symbol = null;
    if (NAMED_KINDS.has(child.type)) {
      const nameNode = child.childForFieldName("name");
      if (nameNode) symbol = nameNode.text;
    } else if (child.type === "type_declaration") {
      symbol = symbolForType(child);
    }
    if (symbol) marks.push({ idx: child.startIndex, symbol });
  }
  return marks;
}

function marksViaRegex(text) {
  const marks = [];
  TOP_RE.lastIndex = 0;
  let m;
  while ((m = TOP_RE.exec(text)) !== null) marks.push({ idx: m.index, symbol: m[1] });
  return marks;
}

export function chunkGo(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const marks = marksViaAST(text) ?? marksViaRegex(text);
  if (marks.length === 0) {
    return windowText(text, limit, overlap).map((piece) => ({
      text: piece,
      metadata: { source: path, kind: "code", symbol: null, language: "go" },
    }));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(start, end);
    for (const piece of windowText(body, limit, overlap)) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: marks[i].symbol, language: "go" } });
    }
  }
  return out;
}
