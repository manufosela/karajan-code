// KJC-TSK-0449 — cross-encoder rerank tests. CI never downloads the
// model weights; we inject a synthetic pipeline via `pipelineFn` so the
// tests cover ordering, input validation, and truncation behaviour.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { rerank, RerankError, _resetPipeline } from "../../src/rag/rerank.js";
import { query } from "../../src/rag/retriever.js";
import { openVecStore, insertChunk } from "../../src/rag/vec-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(() => _resetPipeline());

describe("rerank()", () => {
  it("rejects empty / non-string queryText", async () => {
    await expect(rerank("", [{ text: "a" }])).rejects.toThrow(RerankError);
    await expect(rerank(null, [{ text: "a" }])).rejects.toThrow(RerankError);
  });

  it("rejects non-array hits", async () => {
    await expect(rerank("q", "not-array")).rejects.toThrow(/hits must be an array/);
  });

  it("returns empty hits unchanged", async () => {
    const out = await rerank("q", []);
    expect(out).toEqual([]);
  });

  it("reorders hits by descending pipeline score", async () => {
    const hits = [
      { id: 1, text: "totally unrelated content", source: "a", kind: "code", distance: 0.1 },
      { id: 2, text: "perfect match for auth login", source: "b", kind: "code", distance: 0.2 },
      { id: 3, text: "somewhat related text", source: "c", kind: "code", distance: 0.3 },
    ];
    const pipelineFn = vi.fn().mockResolvedValue([{ score: 0.1 }, { score: 0.95 }, { score: 0.4 }]);
    const out = await rerank("auth login", hits, { pipelineFn });
    expect(out[0].id).toBe(2);
    expect(out[1].id).toBe(3);
    expect(out[2].id).toBe(1);
    expect(out[0]._rerank).toBeCloseTo(0.95, 5);
  });

  it("truncates long passages to maxChars before scoring", async () => {
    const longText = "x".repeat(5000);
    let received;
    const pipelineFn = vi.fn(async (pairs) => { received = pairs; return pairs.map(() => ({ score: 0.5 })); });
    await rerank("q", [{ id: 1, text: longText }], { pipelineFn, maxChars: 100 });
    expect(received[0].text_pair.length).toBe(100);
  });
});

describe("retriever query() with rerankOpts", () => {
  let tmp, db;
  const stubEmbedder = { embed: async () => Float32Array.from([0.5, 0.5, 0.5, 0.5]) };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kj-rerank-"));
    process.env.KJ_RAG_DB = join(tmp, "rag.db");
    db = openVecStore({ dim: 4 });
    insertChunk(db, { source: "a.js", kind: "code", text: "stub a", embedding: [0.1, 0.1, 0.1, 0.1], project: "x" });
    insertChunk(db, { source: "b.js", kind: "code", text: "stub b", embedding: [0.2, 0.2, 0.2, 0.2], project: "x" });
  });

  it("invokes rerank when rerankOpts is set, surfacing the highest-scored hit first", async () => {
    // Score "stub b" higher than "stub a" regardless of retrieval order.
    const pipelineFn = vi.fn(async (pairs) =>
      pairs.map((p) => ({ score: p.text_pair.includes("stub b") ? 0.9 : 0.1 })),
    );
    const hits = await query(db, stubEmbedder, "anything", { topK: 5, project: "x", rerankOpts: { pipelineFn } });
    expect(pipelineFn).toHaveBeenCalledTimes(1);
    expect(hits[0].text).toBe("stub b");
    db.close();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.KJ_RAG_DB;
  });

  // KJC-TSK-1173 (RAG-D): the cross-encoder sees the top N after the boosts and the caller gets
  // the top K of its order; without the model the caller is told and gets the top K as retrieved.
  const seedSix = () => { for (const l of ["c", "d", "e", "f"]) insertChunk(db, { source: `${l}.js`, kind: "code", text: `stub ${l}`, embedding: [0.3, 0.3, 0.3, 0.3], project: "x" }); };
  const done = () => { db.close(); rmSync(tmp, { recursive: true, force: true }); delete process.env.KJ_RAG_DB; };

  it("reranks the top N candidates, not only the top K, and returns the top K of the new order", async () => {
    seedSix();
    const seen = [];
    const pipelineFn = vi.fn(async (pairs) => { seen.push(...pairs.map((p) => p.text_pair)); return pairs.map((p) => ({ score: p.text_pair === "stub e" ? 0.9 : 0.1 })); });
    const hits = await query(db, stubEmbedder, "anything", { topK: 2, project: "x", rerankOpts: { pipelineFn, topN: 5 } });
    expect(seen).toHaveLength(5);
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toBe("stub e");
    expect(await query(db, stubEmbedder, "anything", { topK: 3, project: "x", rerankOpts: { pipelineFn, topN: 1 } })).toHaveLength(3);
    done();
  });

  it("a model that cannot be loaded is unavailable too: the caller is told and nothing is cached", async () => {
    seedSix();
    const onUnavailable = vi.fn();
    const transformersFn = vi.fn(async () => ({ pipeline: async () => { throw new Error("404 no such model"); } }));
    const hits = await query(db, stubEmbedder, "anything", { topK: 2, project: "x", rerankOpts: { transformersFn, onUnavailable } });
    expect(hits).toHaveLength(2);
    expect(onUnavailable.mock.calls[0][0]).toMatchObject({ name: "RerankError", cause: { message: "404 no such model" } });
    await query(db, stubEmbedder, "anything", { topK: 2, project: "x", rerankOpts: { transformersFn, onUnavailable } });
    expect(transformersFn).toHaveBeenCalledTimes(2); // the failed load was not kept
    done();
  });

  it("without the model the caller is told once and gets the top K as retrieved", async () => {
    seedSix();
    const onUnavailable = vi.fn();
    const pipelineFn = vi.fn(async () => { throw Object.assign(new Error("no model"), { name: "RerankError" }); });
    const hits = await query(db, stubEmbedder, "anything", { topK: 3, project: "x", rerankOpts: { pipelineFn, onUnavailable } });
    expect(hits).toHaveLength(3);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable.mock.calls[0][0].message).toBe("no model");
    await expect(query(db, stubEmbedder, "anything", { topK: 3, project: "x", rerankOpts: { pipelineFn } })).rejects.toThrow("no model");
    done();
  });
});
