// KJC-TSK-0483 — unit tests for the retrieval-quality harness. The runner
// is intentionally decoupled from the retriever so we can drive it with
// stub hits and assert recall@k / MRR math + the JSON loader.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadGoldenQueries, scoreQuery, aggregate, runEval } from "../../src/rag/eval.js";

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
