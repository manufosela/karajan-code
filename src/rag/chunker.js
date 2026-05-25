// KJC-PCS-0049 Step 3 — Chunkers for the RAG indexer.
// Each chunker is pure: takes text + opts, returns
// `[{ text, metadata: { source, kind, ...extras } }]`. The indexer
// (Step 4) hands every chunk to the embedder + vec store; the
// retriever (Step 5) reads metadata back to enrich results.

const DEFAULT_CHUNK_LIMIT = 800;
const DEFAULT_OVERLAP = 100;

// ---------- shared splitter ---------------------------------------

/**
 * Split a long string into overlapping windows. Used by every chunker
 * that produces a single section too big for the embedder's context.
 */
function windowText(text, { limit = DEFAULT_CHUNK_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  if (text.length <= limit) return [text];
  const step = Math.max(1, limit - overlap);
  const out = [];
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + limit));
    if (i + limit >= text.length) break;
  }
  return out;
}

// ---------- markdown chunker (plans / onboarding briefs) ----------

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

/**
 * Chunk a markdown document by heading hierarchy. The headingPath
 * metadata tracks ancestors so a retrieval result can show "from
 * '# Plan' › '## Auth' › '### Login'".
 */
export function chunkMarkdown(text, { path = "<inline>", kind = "plan", limit = DEFAULT_CHUNK_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const sections = [];
  const stack = []; // [{ depth, title }]
  let cursor = 0;
  let pending = { headingPath: [], start: 0 };
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(text)) !== null) {
    if (m.index > cursor) {
      pending.body = text.slice(pending.start, m.index).trim();
      if (pending.body) sections.push({ ...pending });
    }
    const depth = m[1].length;
    const title = m[2].trim();
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack.push({ depth, title });
    pending = { headingPath: stack.map((s) => s.title), start: HEADING_RE.lastIndex };
    cursor = HEADING_RE.lastIndex;
  }
  const tail = text.slice(pending.start).trim();
  if (tail) sections.push({ ...pending, body: tail });
  const chunks = [];
  for (const sec of sections) {
    const pieces = windowText(sec.body, { limit, overlap });
    for (const piece of pieces) {
      chunks.push({ text: piece, metadata: { source: path, kind, headingPath: sec.headingPath } });
    }
  }
  return chunks;
}

// ---------- plan chunker (one chunk per HU) -----------------------

/**
 * Chunk a Karajan plan JSON. One chunk per HU; an extra chunk for the
 * plan-level summary if present. The retriever uses hu_id to deep-link
 * back to the board.
 */
export function chunkPlan(plan, { path = "<plan>", limit = DEFAULT_CHUNK_LIMIT } = {}) {
  const out = [];
  if (plan?.summary) {
    const pieces = windowText(String(plan.summary), { limit });
    for (const piece of pieces) {
      out.push({ text: piece, metadata: { source: path, kind: "plan", section: "summary" } });
    }
  }
  for (const hu of plan?.hus || []) {
    const parts = [hu.title, hu.description, hu.scope].filter(Boolean).join("\n\n");
    if (!parts.trim()) continue;
    for (const piece of windowText(parts, { limit })) {
      out.push({ text: piece, metadata: { source: path, kind: "plan", hu_id: hu.id || null, title: hu.title || null } });
    }
  }
  return out;
}

// ---------- source chunker (export-symbol granularity) ------------

import { chunkSourceAST } from "./chunker-ast.js";

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm;

// KJC-TSK-0444 — try AST chunker first (top-level declarations as whole
// units, JSDoc folded in); fall back to the export-regex if @babel/parser
// can't parse the file (returns null).
export function chunkSource(text, opts = {}) {
  const ast = chunkSourceAST(text, opts);
  if (ast) return ast;
  return chunkSourceRegex(text, opts);
}

function chunkSourceRegex(text, { path = "<src>", limit = DEFAULT_CHUNK_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const marks = [];
  EXPORT_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_RE.exec(text)) !== null) marks.push({ idx: m.index, symbol: m[1] });
  if (marks.length === 0) {
    return windowText(text, { limit, overlap })
      .map((piece) => ({ text: piece, metadata: { source: path, kind: "code", symbol: null } }));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(start, end);
    for (const piece of windowText(body, { limit, overlap })) {
      out.push({ text: piece, metadata: { source: path, kind: "code", symbol: marks[i].symbol } });
    }
  }
  return out;
}

export { chunkSourceRegex };
