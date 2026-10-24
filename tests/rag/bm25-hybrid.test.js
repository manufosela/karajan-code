// KJC-TSK-0443 — BM25 keyword search + hybrid fusion.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openVecStore, insertChunk, searchBM25 } from "../../src/rag/vec-store.js";
import { query, fuseHits } from "../../src/rag/retriever.js";

function oneHot(i, d = 8) { const v = new Float32Array(d); v[i % d] = 1; return v; }
function fakeEmb(i) { return { embed: vi.fn(async () => oneHot(i)), dim: 8 }; }

describe("rag/bm25 — KJC-TSK-0443", () => {
  let root, db;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-bm25-")); db = openVecStore({ dim: 8, path: join(root, "rag.db") }); });
  afterEach(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });

  it("FTS5 chunks_fts table exists and counts mirror chunks via triggers", () => {
    insertChunk(db, { source: "/a", kind: "code", text: "alpha auth login bcrypt", embedding: oneHot(0) });
    insertChunk(db, { source: "/b", kind: "code", text: "beta cache LRU eviction", embedding: oneHot(1) });
    const n = db.prepare("SELECT COUNT(*) AS n FROM chunks_fts").get().n;
    expect(n).toBe(2);
  });

  it("searchBM25 ranks exact keyword matches over unrelated chunks", () => {
    insertChunk(db, { source: "/auth", kind: "code", text: "authentication login password bcrypt", embedding: oneHot(0) });
    insertChunk(db, { source: "/cache", kind: "code", text: "LRU cache TTL eviction in-memory", embedding: oneHot(1) });
    insertChunk(db, { source: "/db", kind: "code", text: "postgres connection pool transaction", embedding: oneHot(2) });
    const hits = searchBM25(db, "bcrypt password", 5);
    expect(hits[0].source).toBe("/auth");
  });

  it("searchBM25 returns [] for whitespace-only queries (no FTS syntax leak)", () => {
    expect(searchBM25(db, "   ", 5)).toEqual([]);
    expect(searchBM25(db, "", 5)).toEqual([]);
  });

  it("searchBM25 sanitises FTS5 special characters", () => {
    insertChunk(db, { source: "/x", kind: "code", text: "hello world", embedding: oneHot(0) });
    const hits = searchBM25(db, "hello \"world\"", 5);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("retriever/fuseHits — KJC-TSK-0443", () => {
  it("mode=semantic returns only semantic hits unchanged", () => {
    const sem = [{ id: 1, distance: 0.1 }, { id: 2, distance: 0.2 }];
    expect(fuseHits(sem, [], "semantic")).toEqual(sem);
  });

  it("mode=keyword surfaces bm25 as distance", () => {
    const kw = [{ id: 1, bm25: -3.5 }, { id: 2, bm25: -1.2 }];
    const out = fuseHits([], kw, "keyword");
    expect(out[0].distance).toBe(-3.5);
  });

  // KJC-TSK-1172 (RAG-C): hybrid fusion is Reciprocal Rank Fusion. Each list is best-first; a
  // candidate scores 1/(k + rank) per list, k = 60 by default. `distance` stays lower-is-better.
  it("mode=hybrid fuses by reciprocal rank: present in both lists beats present in one", () => {
    const sem = [{ id: 1, distance: 0.1 }, { id: 2, distance: 0.5 }, { id: 3, distance: 0.9 }];
    const kw = [{ id: 2, bm25: -3 }, { id: 4, bm25: -2 }];
    const out = fuseHits(sem, kw, "hybrid").toSorted((a, b) => a.distance - b.distance);
    expect(out.map((h) => h.id)).toEqual([2, 1, 4, 3]); // 2: rank 2 + rank 1; 1: rank 1 alone; 4: rank 2 alone; 3: rank 3 alone
    const rrf = (ranks) => ranks.reduce((s, r) => s + 1 / (60 + r), 0);
    expect(out[0].distance).toBeCloseTo(1 - rrf([2, 1]) / rrf([1, 1]), 12); // scaled to [0, 1): both firsts would be 0
    expect(out[1].distance).toBeCloseTo(1 - rrf([1]) / rrf([1, 1]), 12);
    expect(out.find((h) => h.id === 4)).toMatchObject({ bm25: -2 });
  });

  it("k is configurable and a smaller k sharpens the gap between ranks", () => {
    const sem = [{ id: 1, distance: 0.1 }, { id: 2, distance: 0.5 }];
    const gap = (rrfK) => { const o = fuseHits(sem, [], "hybrid", { rrfK }); return o[1].distance - o[0].distance; };
    expect(gap(1)).toBeGreaterThan(gap(60));
    expect(fuseHits([], [], "hybrid")).toEqual([]);
  });

  it("query mode=keyword skips embedder (no API call)", async () => {
    const root2 = mkdtempSync(join(tmpdir(), "kj-bm25-q-"));
    const db2 = openVecStore({ dim: 8, path: join(root2, "rag.db") });
    insertChunk(db2, { source: "/x", kind: "code", text: "auth login", embedding: oneHot(0) });
    const emb = fakeEmb(0);
    await query(db2, emb, "auth", { topK: 1, mode: "keyword" });
    expect(emb.embed).not.toHaveBeenCalled();
    db2.close();
    rmSync(root2, { recursive: true, force: true });
  });
});
