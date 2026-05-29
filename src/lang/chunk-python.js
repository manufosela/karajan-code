// KJC-PCS-0052 PR-B — Python source chunker. Top-level `def`/`async def`/
// `class` actúan como frontera de chunk; cada chunk lleva `metadata.symbol`
// con el nombre + `metadata.language: "python"`. Mirrors el regex fallback
// de JS (chunkSourceRegex) — no AST real porque tree-sitter (native vs
// WASM) es decisión separada que vivirá en PR-B.2.
//
// Por qué basta con `^(def|async def|class)` en multiline: top-level en
// Python convive en columna 0; métodos y funciones anidadas tienen
// indentación, así que `^` (sin whitespace previo) las excluye de forma
// natural — caen dentro del chunk de su clase/función padre.

const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;
const TOP_RE = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm;

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

export function chunkPython(text, { path = "<src>", limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const marks = [];
  TOP_RE.lastIndex = 0;
  let m;
  while ((m = TOP_RE.exec(text)) !== null) marks.push({ idx: m.index, symbol: m[1] });
  if (marks.length === 0) {
    return windowText(text, limit, overlap).map((piece) => ({
      text: piece,
      metadata: { source: path, kind: "code", symbol: null, language: "python" },
    }));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(start, end);
    for (const piece of windowText(body, limit, overlap)) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: marks[i].symbol, language: "python" } });
    }
  }
  return out;
}
