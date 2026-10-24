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

// KJC-TSK-1170 (RAG-E): latency travels with recall and MRR. p95 is the nearest-rank
// percentile over the measured queries; both are rounded to whole milliseconds.
function latencyOf(results) {
  const ms = results.map((r) => r.ms).filter((v) => Number.isFinite(v)).toSorted((a, b) => a - b);
  if (ms.length === 0) return null;
  const meanMs = Math.round(ms.reduce((acc, v) => acc + v, 0) / ms.length);
  const p95Ms = Math.round(ms[Math.max(0, Math.ceil(ms.length * 0.95) - 1)]);
  return { meanMs, p95Ms };
}

export function aggregate(results, ks = DEFAULT_KS) {
  const n = results.length || 1;
  const recall = {};
  for (const k of ks) {
    recall[`@${k}`] = results.reduce((acc, r) => acc + (r.recall[`@${k}`] || 0), 0) / n;
  }
  const mrr = results.reduce((acc, r) => acc + (r.rr || 0), 0) / n;
  const latency = latencyOf(results);
  return { n: results.length, recall, mrr, ...(latency ? { latency } : {}) };
}

export async function runEval(queries, runQuery, { topK = 10, ks = DEFAULT_KS, now = () => performance.now() } = {}) {
  const results = [];
  for (const q of queries) {
    const started = now();
    const hits = (await runQuery(q.query, topK)) || [];
    const ms = now() - started;
    const expected = { sources: q.expected_sources || [], symbols: q.expected_symbols || [] };
    const scored = scoreQuery(hits, expected, ks);
    results.push({ query: q.query, hits, ms, ...scored });
  }
  return { results, aggregate: aggregate(results, ks) };
}

/**
 * KJC-TSK-1170: the current aggregate against a frozen one. Recall and MRR may not drop
 * more than `tolerance`; p95 latency may not exceed the baseline's by `latencyFactor`,
 * and is skipped when the baseline recorded none. Pure: the caller reads the files.
 * @returns {{ok: boolean, problems: string[]}}
 */
export function compareToBaseline(current, baseline, { tolerance = 0, latencyFactor = 2 } = {}) {
  const problems = [];
  for (const k of Object.keys(baseline.recall ?? {})) {
    const now = current.recall?.[k] ?? 0;
    if (now < baseline.recall[k] - tolerance) problems.push(`recall${k} ${now.toFixed(3)} < ${baseline.recall[k].toFixed(3)}`);
  }
  if ((current.mrr ?? 0) < (baseline.mrr ?? 0) - tolerance) problems.push(`MRR ${(current.mrr ?? 0).toFixed(3)} < ${baseline.mrr.toFixed(3)}`);
  const baseP95 = baseline.latency?.p95Ms;
  if (Number.isFinite(baseP95) && Number.isFinite(current.latency?.p95Ms)) {
    const limit = Math.round(baseP95 * latencyFactor);
    if (current.latency.p95Ms > limit) problems.push(`p95 ${current.latency.p95Ms} ms > ${limit} ms (${latencyFactor}x the baseline's ${baseP95} ms)`);
  }
  return { ok: problems.length === 0, problems };
}
