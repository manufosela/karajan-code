// KJC-TSK-0483 — Retrieval-quality harness. Loads a golden set of queries
// (each with expected source paths and/or symbol names), runs the retriever
// against each, and reports recall@k + MRR per query and aggregated. Pure:
// the runner takes `runQuery` as a function so the CLI plugs in `query()`
// while tests can use a stub.
import { readFileSync } from "node:fs";

const DEFAULT_KS = [5, 10];

export function loadGoldenQueries(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data)) throw new Error(`golden queries: expected an array in ${path}`);
  return data;
}

function hitMatchesExpected(hit, expected) {
  if (!hit) return false;
  const src = hit.source || "";
  if (expected.sources?.some((s) => src.endsWith(s))) return true;
  const sym = hit.metadata?.symbol;
  if (sym && expected.symbols?.includes(sym)) return true;
  return false;
}

// Per-query metrics. `recall@k` is binary — 1 if any expected match lands in
// the top-k, else 0. `rr` is the reciprocal of the first relevant rank (1 if
// the very first hit matches, 0 if none do). `firstRank` is null on miss so
// callers can render "—" without re-checking.
export function scoreQuery(hits, expected, ks = DEFAULT_KS) {
  const recall = {};
  for (const k of ks) {
    recall[`@${k}`] = hits.slice(0, k).some((h) => hitMatchesExpected(h, expected)) ? 1 : 0;
  }
  let firstRank = null;
  let rr = 0;
  for (let i = 0; i < hits.length; i += 1) {
    if (hitMatchesExpected(hits[i], expected)) { firstRank = i + 1; rr = 1 / firstRank; break; }
  }
  return { recall, rr, firstRank };
}

export function aggregate(results, ks = DEFAULT_KS) {
  const n = results.length || 1;
  const recall = {};
  for (const k of ks) {
    recall[`@${k}`] = results.reduce((acc, r) => acc + (r.recall[`@${k}`] || 0), 0) / n;
  }
  const mrr = results.reduce((acc, r) => acc + (r.rr || 0), 0) / n;
  return { n: results.length, recall, mrr };
}

export async function runEval(queries, runQuery, { topK = 10, ks = DEFAULT_KS } = {}) {
  const results = [];
  for (const q of queries) {
    const hits = (await runQuery(q.query, topK)) || [];
    const expected = { sources: q.expected_sources || [], symbols: q.expected_symbols || [] };
    const scored = scoreQuery(hits, expected, ks);
    results.push({ query: q.query, hits, ...scored });
  }
  return { results, aggregate: aggregate(results, ks) };
}
