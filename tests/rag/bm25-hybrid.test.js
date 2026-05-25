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
    expect(fuseHits(sem, [], 0.6, "semantic")).toEqual(sem);
  });

  it("mode=keyword surfaces bm25 as distance", () => {
    const kw = [{ id: 1, bm25: -3.5 }, { id: 2, bm25: -1.2 }];
    const out = fuseHits([], kw, 0.6, "keyword");
    expect(out[0].distance).toBe(-3.5);
  });

  it("mode=hybrid normalises + linear-combines both scores", () => {
    const sem = [{ id: 1, distance: 0.1 }, { id: 2, distance: 0.5 }];
    const kw = [{ id: 1, bm25: -1 }, { id: 2, bm25: -3 }];
    const out = fuseHits(sem, kw, 0.5, "hybrid");
    // id=1 has best semantic (dist=0.1) but worst keyword (bm25=-1, less negative = less relevant)
    // id=2 has worst semantic (dist=0.5) but best keyword (bm25=-3, more negative = more relevant)
    // With alpha=0.5 the tie should resolve cleanly to a finite distance per id
    expect(out.length).toBe(2);
    out.forEach((h) => expect(Number.isFinite(h.distance)).toBe(true));
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
