// KJC-TSK-0444 — AST-aware source chunker. Replaces the regex-based
// chunkSource for JS/TS/JSX files. Each top-level declaration (function,
// class, var/const, export named/default) becomes one chunk whose `text`
// is the literal source slice [node.start, node.end]. Comments
// immediately preceding a declaration are folded in (JSDoc + leading
// line comments) so the chunk reads like a doc-aware snippet.
//
// Falls back to the regex chunker if @babel/parser cannot parse the
// file (errorRecovery: true catches most cases; a hard syntax error
// returns null so the caller can fall back).
import { parse } from "@babel/parser";
import { pieceSpans } from "../lang/chunk-span.js";

const PLUGINS = ["typescript", "jsx", "decorators-legacy", "classProperties", "topLevelAwait"];

export function chunkSourceAST(text, { path = "<src>", limit = 800, overlap = 100 } = {}) {
  let ast;
  try { ast = parse(text, { sourceType: "module", errorRecovery: true, plugins: PLUGINS }); }
  catch { return null; }
  const body = ast?.program?.body;
  if (!Array.isArray(body) || body.length === 0) return null;
  const out = [];
  for (const node of body) {
    const sym = extractSymbol(node);
    const start = leadingCommentsStart(node);
    const slice = text.slice(start, node.end ?? start);
    if (!slice.trim()) continue;
    // KJC-TSK-1171: each piece carries its line range; top-level declarations have no parent.
    for (const { text: piece, start_line, end_line } of pieceSpans(text, start, slice, { limit, overlap })) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: sym, parent: null, start_line, end_line } });
    }
  }
  return out.length === 0 ? null : out;
}

function extractSymbol(node) {
  if (node.type === "ExportNamedDeclaration" && node.declaration) return extractSymbol(node.declaration);
  if (node.type === "ExportDefaultDeclaration") return "default";
  if (node.id?.name) return node.id.name;
  if (node.declarations?.[0]?.id?.name) return node.declarations[0].id.name;
  return null;
}

function leadingCommentsStart(node) {
  const lc = node.leadingComments;
  if (Array.isArray(lc) && lc.length > 0) return lc[0].start ?? node.start ?? 0;
  return node.start ?? 0;
}

