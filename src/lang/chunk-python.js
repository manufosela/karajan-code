// KJC-PCS-0052 PR-B.2.1 — Python source chunker (tree-sitter + regex fallback).
// Top-level `def`/`async def`/`class` siguen siendo la frontera de chunk, pero
// ahora con dos caminos:
//   1. AST (web-tree-sitter): si el caller hizo `await preparePython()` antes
//      del indexado, leemos el árbol y capturamos solo nodos cuyo `parent.type`
//      es `module` — eso excluye métodos anidados sin depender de la
//      indentación visual y captura decoradores (`decorated_definition`)
//      apuntando al def/class real subyacente.
//   2. Regex: fallback síncrono para entornos sin tree-sitter listo (tests
//      legacy, primera invocación antes de `preparePython`). Misma semántica
//      que PR-B.
//
// El contrato externo no cambia: `chunkPython(text, opts)` es síncrono y
// devuelve `[{ text, metadata: { source, kind, symbol, language } }]`.

import { getLoaded, loadLanguage } from "./tree-sitter-loader.js";
import { spanChunks } from "./chunk-span.js";

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const TOP_RE = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm;

export async function preparePython() {
  return loadLanguage("python");
}


function marksViaAST(text) {
  const entry = getLoaded("python");
  if (!entry) return null;
  let tree;
  try {
    tree = entry.parser.parse(text);
  } catch {
    return null;
  }
  const marks = [];
  for (const child of tree.rootNode.namedChildren) {
    let defNode = null;
    if (child.type === "function_definition" || child.type === "class_definition") {
      defNode = child;
    } else if (child.type === "decorated_definition") {
      defNode = child.childForFieldName("definition");
    }
    if (!defNode) continue;
    const nameNode = defNode.childForFieldName("name");
    if (!nameNode) continue;
    marks.push({ idx: child.startIndex, symbol: nameNode.text });
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

export function chunkPython(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  return spanChunks(text, marksViaAST(text) ?? marksViaRegex(text), { path, language: "python", limit, overlap });
}
