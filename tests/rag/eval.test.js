// KJC-TSK-0483 — unit tests for the retrieval-quality harness. The runner
// is intentionally decoupled from the retriever so we can drive it with
// stub hits and assert recall@k / MRR math + the JSON loader.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadGoldenQueries, scoreQuery, aggregate, runEval, compareToBaseline } from "../../src/rag/eval.js";

function hit({ source, symbol }) {
  return { source, metadata: symbol ? { symbol } : null };
}

describe("scoreQuery — KJC-TSK-0483", () => {
  it("recall@k binary + MRR reciprocal of first relevant rank", () => {
    const hits = [
      hit({ source: "src/rag/other.js" }),
      hit({ source: "src/rag/vec-store.js", symbol: "openVecStore" }),
      hit({ source: "src/rag/indexer.js" }),
    ];
    const r = scoreQuery(hits, { sources: ["src/rag/vec-store.js"], symbols: [] }, [1, 5]);
    expect(r.recall["@1"]).toBe(0);
    expect(r.recall["@5"]).toBe(1);
    expect(r.firstRank).toBe(2);
    expect(r.rr).toBeCloseTo(0.5, 5);
  });
  it("symbol-only match still scores even if source path differs", () => {
    const r = scoreQuery([hit({ source: "src/x.js", symbol: "openVecStore" })], { sources: [], symbols: ["openVecStore"] }, [5]);
    expect(r.recall["@5"]).toBe(1);
    expect(r.rr).toBe(1);
  });
  it("returns zeros when no hit matches", () => {
    const r = scoreQuery([hit({ source: "a.js" }), hit({ source: "b.js" })], { sources: ["c.js"], symbols: [] }, [5, 10]);
    expect(r.recall["@5"]).toBe(0);
    expect(r.recall["@10"]).toBe(0);
    expect(r.rr).toBe(0);
    expect(r.firstRank).toBeNull();
  });
});

describe("aggregate / runEval — KJC-TSK-0483", () => {
  it("aggregates recall and MRR across queries", () => {
    const results = [
      { recall: { "@5": 1 }, rr: 1 },
      { recall: { "@5": 1 }, rr: 0.5 },
      { recall: { "@5": 0 }, rr: 0 },
    ];
    const agg = aggregate(results, [5]);
    expect(agg.n).toBe(3);
    expect(agg.recall["@5"]).toBeCloseTo(2 / 3, 5);
    expect(agg.mrr).toBeCloseTo((1 + 0.5 + 0) / 3, 5);
  });
  it("runEval drives a stub retriever and produces results + aggregate", async () => {
    const queries = [
      { query: "find openVecStore", expected_sources: ["vec-store.js"] },
      { query: "missing-target", expected_sources: ["does-not-exist.js"] },
    ];
    const stub = async (q) => q.includes("openVecStore")
      ? [hit({ source: "/abs/path/vec-store.js" })]
      : [hit({ source: "/abs/path/other.js" })];
    const { results, aggregate: agg } = await runEval(queries, stub, { topK: 5, ks: [5] });
    expect(results).toHaveLength(2);
    expect(results[0].recall["@5"]).toBe(1);
    expect(results[1].recall["@5"]).toBe(0);
    expect(agg.recall["@5"]).toBe(0.5);
    expect(agg.mrr).toBeCloseTo(0.5, 5);
  });
});

// KJC-TSK-1170 (RAG-E): latency travels with the metrics, and a frozen baseline says
// whether a change to the retriever made things worse.
describe("latency and baseline — KJC-TSK-1170", () => {
  const ticks = (...ms) => { let i = 0; const t = [0, ...ms]; return () => t[Math.min(i++, t.length - 1)]; };

  it("runEval measures each query and aggregate reports mean and p95 latency", async () => {
    const stub = async () => [hit({ source: "a.js" })];
    const queries = Array.from({ length: 4 }, (_, i) => ({ query: `q${i}`, expected_sources: ["a.js"] }));
    // now() is read before and after each query: 10, 20, 30, 100 ms.
    const now = ticks(10, 10, 30, 30, 60, 60, 160, 160);
    const { results, aggregate: agg } = await runEval(queries, stub, { topK: 5, ks: [5], now });
    expect(results.map((r) => r.ms)).toEqual([10, 20, 30, 100]);
    expect(agg.latency).toEqual({ meanMs: 40, p95Ms: 100 });
  });

  it("compareToBaseline passes when nothing got worse and names what did", () => {
    const base = { recall: { "@5": 0.8, "@10": 0.9 }, mrr: 0.6, latency: { meanMs: 50, p95Ms: 120 } };
    expect(compareToBaseline({ recall: { "@5": 0.8, "@10": 0.95 }, mrr: 0.61, latency: { meanMs: 60, p95Ms: 200 } }, base)).toEqual({ ok: true, problems: [] });
    const worse = compareToBaseline({ recall: { "@5": 0.7, "@10": 0.9 }, mrr: 0.5, latency: { meanMs: 50, p95Ms: 300 } }, base);
    expect(worse.ok).toBe(false);
    expect(worse.problems).toEqual([
      expect.stringMatching(/recall@5 0\.700 < 0\.800/),
      expect.stringMatching(/MRR 0\.500 < 0\.600/),
      expect.stringMatching(/p95 300 ms > 240 ms \(2x/),
    ]);
  });

  // KJC-BUG-0394: a baseline of a few milliseconds must not turn machine noise into a regression.
  it("compareToBaseline allows an absolute floor over a tiny baseline latency", () => {
    const base = { recall: { "@5": 1 }, mrr: 1, latency: { meanMs: 1, p95Ms: 2 } };
    expect(compareToBaseline({ recall: { "@5": 1 }, mrr: 1, latency: { meanMs: 20, p95Ms: 40 } }, base).ok).toBe(true);
    const far = compareToBaseline({ recall: { "@5": 1 }, mrr: 1, latency: { meanMs: 20, p95Ms: 60 } }, base);
    expect(far.problems).toEqual([expect.stringMatching(/p95 60 ms > 52 ms/)]);
    expect(compareToBaseline({ recall: { "@5": 1 }, mrr: 1, latency: { meanMs: 1, p95Ms: 9 } }, base, { latencyFloorMs: 5 }).ok).toBe(false);
  });

  it("compareToBaseline skips latency when the baseline has none, and honours the margins given", () => {
    const base = { recall: { "@5": 0.8 }, mrr: 0.6 };
    expect(compareToBaseline({ recall: { "@5": 0.79 }, mrr: 0.59, latency: { meanMs: 1, p95Ms: 1 } }, base, { tolerance: 0.02 }).ok).toBe(true);
    expect(compareToBaseline({ recall: { "@5": 0.8 }, mrr: 0.6, latency: { meanMs: 1, p95Ms: 130 } }, { ...base, latency: { meanMs: 1, p95Ms: 100 } }, { latencyFactor: 1.2, latencyFloorMs: 0 }).ok).toBe(false);
  });
});

describe("loadGoldenQueries — KJC-TSK-0483", () => {
  it("parses an array of golden entries", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kj-golden-"));
    const f = join(tmp, "g.json");
    try {
      writeFileSync(f, JSON.stringify([{ query: "x", expected_sources: ["y.js"] }]));
      const out = loadGoldenQueries(f);
      expect(out).toHaveLength(1);
      expect(out[0].query).toBe("x");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("throws when the file does not contain an array", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kj-golden-"));
    const f = join(tmp, "g.json");
    try {
      writeFileSync(f, JSON.stringify({ not: "array" }));
      expect(() => loadGoldenQueries(f)).toThrow(/expected an array/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
