// KJC-PCS-0049 Step 5 — Retriever for the RAG pipeline.
import { searchSimilar, searchBM25 } from "./vec-store.js";

const DEFAULT_KIND_BOOST = { plan: 0.05, onboarding: 0.03, code: 0 };

// KJC-TSK-0440 — asymmetric source/test boost.
const SOURCE_BOOST_NON_TEST = 0.05;
const TEST_TERMS_RE = /\b(test|tests|spec|specs|expect|describe|it\(|jest|vitest|mocha)\b/i;
const TEST_PATH_RE = /[\\/](tests?|specs?|__tests__)[\\/]|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/i;

function shouldBoostSources(queryText) { return !TEST_TERMS_RE.test(queryText); }
function isTestPath(source) { return TEST_PATH_RE.test(source || ""); }

// KJC-TSK-0443 — fuse semantic + keyword hits into a unified candidate set.
// For 'semantic'/'keyword' modes we surface that side. For 'hybrid' (default)
// we min-max normalise both scores to [0,1] (lower=better) and linear-combine
// via alpha * semantic + (1-alpha) * keyword. Result written back to
// `distance` so the kind+source boost pipeline keeps working unchanged.
function fuseHits(semantic, keyword, alpha, mode) {
  if (mode === "semantic") return semantic;
  if (mode === "keyword") return keyword.map((h) => ({ ...h, distance: h.bm25 }));
  const byId = new Map();
  for (const h of semantic) byId.set(h.id, { ...h, _sem: h.distance });
  for (const h of keyword) {
    const prev = byId.get(h.id);
    if (prev) prev._kw = h.bm25;
    else byId.set(h.id, { ...h, _kw: h.bm25, distance: h.bm25 });
  }
  const list = [...byId.values()];
  const norm = (vals) => {
    const xs = vals.filter((v) => Number.isFinite(v));
    if (xs.length === 0) return () => 0.5;
    const min = Math.min(...xs); const max = Math.max(...xs); const span = max - min || 1;
    return (v) => Number.isFinite(v) ? (v - min) / span : 1;
  };
  const nSem = norm(list.map((h) => h._sem));
  const nKw = norm(list.map((h) => h._kw));
  for (const h of list) h.distance = alpha * nSem(h._sem) + (1 - alpha) * nKw(h._kw);
  return list;
}

export async function query(db, embedder, text, { topK = 5, scope = "all", kindBoost = DEFAULT_KIND_BOOST, project = null, mode = "hybrid", alpha = 0.6 } = {}) {
  if (!text || typeof text !== "string") throw new Error("query: text must be a non-empty string");
  const fetchK = Math.min(50, topK * 2);
  const scopeKind = scope === "plans" ? "plan" : scope === "code" ? "code" : scope === "onboarding" ? "onboarding" : null;
  const wantSemantic = mode !== "keyword";
  const wantKeyword = mode !== "semantic";
  const semanticHits = wantSemantic ? searchSimilar(db, await embedder.embed(text), fetchK, { kind: scopeKind, project }) : [];
  const keywordHits = wantKeyword ? searchBM25(db, text, fetchK, { kind: scopeKind, project }) : [];
  const raw = fuseHits(semanticHits, keywordHits, alpha, mode);
  if (raw.length === 0) return [];
  const boostSources = shouldBoostSources(text);
  const reranked = raw.map((r) => {
    const kindB = kindBoost[r.kind] || 0;
    const sourceB = (boostSources && r.kind === "code" && !isTestPath(r.source)) ? SOURCE_BOOST_NON_TEST : 0;
    return { ...r, score: r.distance - kindB - sourceB };
  }).sort((a, b) => a.score - b.score).slice(0, topK);
  return reranked;
}

export { shouldBoostSources, isTestPath, fuseHits };
