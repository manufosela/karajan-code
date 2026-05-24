// KJC-PCS-0049 Step 5 — Retriever for the RAG pipeline. Composes the
// embedder (Step 2) + vec store (Step 1) into a one-call query API.
// The CLI (Step 6) and the future MCP tool are the only consumers.

import { searchSimilar } from "./vec-store.js";

// Kind boosts for rerank: a plan chunk is more "intentional" than a
// raw code chunk, an onboarding brief sits between them. Tunable via
// the third argument; the defaults are conservative — they break ties
// between equidistant chunks but won't reorder by big distance gaps.
const DEFAULT_KIND_BOOST = { plan: 0.05, onboarding: 0.03, code: 0 };

/**
 * Run a natural-language query against the indexed RAG corpus. Returns
 * the top-K chunks ranked by adjusted distance (lower = closer).
 *
 *   query(db, embedder, "how did I handle auth in module X?",
 *         { topK: 5, scope: 'plans' })
 *
 * @param {Database} db           — opened via openVecStore()
 * @param {OllamaEmbedder} embedder
 * @param {string} text           — the query
 * @param {Object} [opts]
 * @param {number} [opts.topK=5]
 * @param {'plans'|'code'|'onboarding'|'all'} [opts.scope='all']
 * @param {Object} [opts.kindBoost]
 */
export async function query(db, embedder, text, { topK = 5, scope = "all", kindBoost = DEFAULT_KIND_BOOST, project = null } = {}) {
  if (!text || typeof text !== "string") throw new Error("query: text must be a non-empty string");
  const queryEmbedding = await embedder.embed(text);
  // Over-fetch (topK * 2) so the rerank step has room to reshuffle
  // without dropping a relevant chunk past the cut. Clamped at 50 to
  // avoid loading the entire store on tiny topK calls.
  const fetchK = Math.min(50, topK * 2);
  const scopeKind = scope === "plans" ? "plan" : scope === "code" ? "code" : scope === "onboarding" ? "onboarding" : null;
  // KJC-TSK-0438 — `project` filters by chunks.project_slug. null means
  // no filter (pre-v2.27 behaviour). Caller's CLI defaults this to the
  // basename of cwd; pass "all" through commands/rag.js to disable.
  const raw = searchSimilar(db, queryEmbedding, fetchK, { kind: scopeKind, project });
  if (raw.length === 0) return [];
  // Adjust each chunk's distance by its kind boost. The vec store returns
  // cosine distance (smaller = closer); subtracting the boost makes
  // higher-priority kinds appear "closer" without altering the source
  // truth in the DB.
  const reranked = raw.map((r) => ({
    ...r,
    score: r.distance - (kindBoost[r.kind] || 0),
  })).sort((a, b) => a.score - b.score).slice(0, topK);
  return reranked;
}
