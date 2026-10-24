// KJC-PCS-0049 Step 5 — Retriever for the RAG pipeline.
import { searchSimilar, searchBM25, getEmbeddingsByIds } from "../vec-store.js";
import { parseWhere, buildWhereSql } from "./where-parser.js";
import { rerank } from "./rerank.js";

const DEFAULT_KIND_BOOST = { plan: 0.05, onboarding: 0.03, code: 0 };

// KJC-TSK-0440 — asymmetric source/test boost.
const SOURCE_BOOST_NON_TEST = 0.05;
const TEST_TERMS_RE = /\b(test|tests|spec|specs|expect|describe|it\(|jest|vitest|mocha)\b/i;
const TEST_PATH_RE = /[\\/](tests?|specs?|__tests__)[\\/]|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/i;

function shouldBoostSources(queryText) { return !TEST_TERMS_RE.test(queryText); }
function isTestPath(source) { return TEST_PATH_RE.test(source || ""); }

// KJC-TSK-1172 (RAG-C, ADR 0026) — fuse semantic + keyword hits by Reciprocal Rank Fusion.
// For 'semantic'/'keyword' modes we surface that side. For 'hybrid' (default) each list is
// best-first and a candidate scores 1/(k + rank) per list it appears in: no scale of either
// backend to normalise, no alpha to tune by hand. The sum is scaled to [0, 1) lower-is-better
// (0 = first in both lists) and written to `distance`, so the kind+source boosts, sized for a
// unit scale, keep working unchanged.
export const DEFAULT_RRF_K = 60;
function fuseHits(semantic, keyword, mode, { rrfK = DEFAULT_RRF_K } = {}) {
  if (mode === "semantic") return semantic;
  if (mode === "keyword") return keyword.map((h) => ({ ...h, distance: h.bm25 }));
  const byId = new Map();
  const add = (list) => list.forEach((h, i) => {
    const prev = byId.get(h.id) ?? { ...h, _rrf: 0 };
    prev._rrf += 1 / (rrfK + i + 1);
    byId.set(h.id, prev);
  });
  add(semantic);
  add(keyword);
  const best = 2 / (rrfK + 1);
  return [...byId.values()].map(({ _rrf, ...h }) => ({ ...h, distance: 1 - _rrf / best }));
}

// KJC-TSK-0484 PR-B — Maximal Marginal Relevance. Given an ordered list of
// candidates (best-first by `score`), pick `topK` that balance relevance
// against intra-result diversity. `lambda=1` collapses to plain relevance;
// `lambda=0` maximises diversity. Cosine sim between candidate embeddings
// drives the redundancy penalty. Candidates without an embedding are kept
// at the end (no penalty applies).
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function mmrRerank(candidates, embeddings, { topK, lambda = 0.7 }) {
  const remaining = candidates.slice();
  const picked = [];
  const relevance = (c) => 1 / (1 + Math.max(0, c.score ?? c.distance ?? 0));
  while (picked.length < topK && remaining.length > 0) {
    let bestIdx = 0; let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const c = remaining[i];
      const rel = relevance(c);
      let maxSim = 0;
      const ce = embeddings.get(c.id);
      if (ce && picked.length > 0) {
        for (const p of picked) {
          const pe = embeddings.get(p.id);
          if (pe) maxSim = Math.max(maxSim, cosineSim(ce, pe));
        }
      }
      const score = lambda * rel - (1 - lambda) * maxSim;
      if (score > bestVal) { bestVal = score; bestIdx = i; }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}

export async function query(db, embedder, text, { topK = 5, scope = "all", kindBoost = DEFAULT_KIND_BOOST, project = null, mode = "hybrid", rrfK = DEFAULT_RRF_K, where = null, whereRoot = null, rerankOpts = null, diversify = false, mmrLambda = 0.7 } = {}) {
  if (!text || typeof text !== "string") throw new Error("query: text must be a non-empty string");
  const fetchK = Math.min(50, topK * 2);
  const scopeKind = scope === "plans" ? "plan" : scope === "code" ? "code" : scope === "onboarding" ? "onboarding" : null;
  // KJC-TSK-0448 — metadata filter. `where` is a string like "symbol=Foo AND
  // hu_id=HU-003"; we parse once and reuse the SQL fragment across both
  // semantic and keyword searches.
  const parsed = parseWhere(where);
  if (!parsed.ok) throw new Error(`query: ${parsed.error}`);
  // KJC-TSK-1179: a relative `source~=` prefix is placed under the project root the caller names.
  const { sql: whereSql, params: whereParams } = buildWhereSql(parsed.clauses, { root: whereRoot });
  const opts = { kind: scopeKind, project, whereSql, whereParams };
  const wantSemantic = mode !== "keyword";
  const wantKeyword = mode !== "semantic";
  const semanticHits = wantSemantic ? searchSimilar(db, await embedder.embed(text), fetchK, opts) : [];
  const keywordHits = wantKeyword ? searchBM25(db, text, fetchK, opts) : [];
  const raw = fuseHits(semanticHits, keywordHits, mode, { rrfK });
  if (raw.length === 0) return [];
  const boostSources = shouldBoostSources(text);
  const scored = raw.map((r) => {
    const kindB = kindBoost[r.kind] || 0;
    const sourceB = (boostSources && r.kind === "code" && !isTestPath(r.source)) ? SOURCE_BOOST_NON_TEST : 0;
    return { ...r, score: r.distance - kindB - sourceB };
  }).sort((a, b) => a.score - b.score);
  // KJC-TSK-0484 PR-B — MMR diversification over topK*2 candidates. Fetches
  // embeddings only when requested; cosine between candidate vectors drives
  // the redundancy penalty so near-duplicates that survived dedup (e.g. a
  // boilerplate chunk repeated under slightly different wording) get pushed
  // down. Skipped entirely when `diversify=false` (default).
  let reranked;
  if (diversify) {
    const pool = scored.slice(0, Math.min(scored.length, topK * 2));
    const embeddings = getEmbeddingsByIds(db, pool.map((c) => c.id));
    reranked = mmrRerank(pool, embeddings, { topK, lambda: mmrLambda });
  } else {
    reranked = scored.slice(0, topK);
  }
  // KJC-TSK-0449 — optional cross-encoder rerank. When `rerankOpts` is set,
  // we re-score the topK survivors with a (query, passage) cross-encoder;
  // the kind+source boost has already been applied, so the rerank acts as
  // a finer-grained quality lever on top.
  if (rerankOpts) return await rerank(text, reranked, rerankOpts);
  return reranked;
}

export { fuseHits, cosineSim };
