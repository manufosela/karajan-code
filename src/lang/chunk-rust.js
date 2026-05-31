// KJC-PCS-0052 PR-B.2.2 — Rust source chunker (tree-sitter + regex fallback).
// Mismo contrato síncrono que chunk-python: AST si el caller awaited
// `prepareRust()` antes, regex si no. Top-level items (fn / struct / enum /
// trait / impl / mod) son la frontera de chunk.
//
// El nodo `impl_item` no tiene field `name`; usamos el campo `type` para
// que metadata.symbol apunte al tipo implementado (útil para grep en RAG).

import { getLoaded, loadLanguage } from "./tree-sitter-loader.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const NAMED_KINDS = new Set([
  "function_item",
  "struct_item",
  "enum_item",
  "trait_item",
  "mod_item",
  "type_item",
  "union_item",
]);
const TOP_RE = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|extern\s+(?:"[^"]+"\s+)?)*(?:fn|struct|enum|trait|mod|type|union|impl)(?:\s+(?:<[^>]+>\s+)?)?([A-Za-z_][\w]*)/gm;

export async function prepareRust() {
  return loadLanguage("rust");
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

function symbolForImpl(node) {
  const typeNode = node.childForFieldName("type");
  return typeNode ? typeNode.text : null;
}

function marksViaAST(text) {
  const entry = getLoaded("rust");
  if (!entry) return null;
  let tree;
  try {
    tree = entry.parser.parse(text);
  } catch {
    return null;
  }
  const marks = [];
  let pendingAttrStart = null;
  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "attribute_item" || child.type === "inner_attribute_item") {
      if (pendingAttrStart === null) pendingAttrStart = child.startIndex;
      continue;
    }
    let symbol = null;
    if (NAMED_KINDS.has(child.type)) {
      const nameNode = child.childForFieldName("name");
      if (nameNode) symbol = nameNode.text;
    } else if (child.type === "impl_item") {
      symbol = symbolForImpl(child);
    }
    if (symbol) {
      const idx = pendingAttrStart ?? child.startIndex;
      marks.push({ idx, symbol });
    }
    pendingAttrStart = null;
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

export function chunkRust(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const marks = marksViaAST(text) ?? marksViaRegex(text);
  if (marks.length === 0) {
    return windowText(text, limit, overlap).map((piece) => ({
      text: piece,
      metadata: { source: path, kind: "code", symbol: null, language: "rust" },
    }));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(start, end);
    for (const piece of windowText(body, limit, overlap)) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: marks[i].symbol, language: "rust" } });
    }
  }
  return out;
}
