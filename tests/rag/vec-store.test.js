// KJC-PCS-0049 Step 1 — vec-store acceptance pins.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openVecStore, insertChunk, searchSimilar, deleteChunksBySource, countChunks, dbPath, projectSlug,
} from "../../src/rag/vec-store.js";

// Synthetic one-hot embeddings → predictable cosine ordering.
function oneHot(idx, dim = 8) {
  const v = new Float32Array(dim); v[idx % dim] = 1; return v;
}

describe("vec-store — KJC-PCS-0049 Step 1", () => {
  let dbFile, db;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "kj-vec-"));
    dbFile = join(dir, "rag.db");
    db = openVecStore({ dim: 8, path: dbFile });
  });
  afterEach(() => {
    db?.close();
    if (existsSync(dbFile)) rmSync(dbFile.replace("/rag.db", ""), { recursive: true, force: true });
  });

  it("creates the DB + schema and the file is materialised on disk", () => {
    expect(existsSync(dbFile)).toBe(true);
    expect(countChunks(db)).toBe(0);
  });

  it("insertChunk persists a row and returns a numeric id", () => {
    const id = insertChunk(db, {
      source: "/tmp/a.md", kind: "plan", text: "hello", metadata: { tag: "x" }, embedding: oneHot(0),
    });
    expect(typeof id).toBe("number");
    expect(countChunks(db)).toBe(1);
    expect(countChunks(db, { kind: "plan" })).toBe(1);
    expect(countChunks(db, { kind: "code" })).toBe(0);
  });

  it("searchSimilar returns the nearest chunks ordered by distance", () => {
    insertChunk(db, { source: "/a", kind: "plan", text: "A", embedding: oneHot(0) });
    insertChunk(db, { source: "/b", kind: "plan", text: "B", embedding: oneHot(1) });
    insertChunk(db, { source: "/c", kind: "plan", text: "C", embedding: oneHot(2) });
    const hits = searchSimilar(db, oneHot(1), 3);
    expect(hits[0].text).toBe("B"); // exact match → distance 0
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
    expect(hits[0].metadata).toBeNull();
  });

  it("searchSimilar honours the kind filter", () => {
    insertChunk(db, { source: "/p", kind: "plan", text: "plan-A", embedding: oneHot(0) });
    insertChunk(db, { source: "/c", kind: "code", text: "code-A", embedding: oneHot(0) });
    const onlyCode = searchSimilar(db, oneHot(0), 5, { kind: "code" });
    expect(onlyCode.length).toBe(1);
    expect(onlyCode[0].kind).toBe("code");
  });

  it("deleteChunksBySource removes from both tables and returns the count", () => {
    insertChunk(db, { source: "/a", kind: "plan", text: "x", embedding: oneHot(0) });
    insertChunk(db, { source: "/a", kind: "plan", text: "y", embedding: oneHot(1) });
    insertChunk(db, { source: "/b", kind: "plan", text: "z", embedding: oneHot(2) });
    expect(deleteChunksBySource(db, "/a")).toBe(2);
    expect(countChunks(db)).toBe(1);
    expect(searchSimilar(db, oneHot(0), 5).every((r) => r.source !== "/a")).toBe(true);
  });

  it("openVecStore is idempotent on a populated DB", () => {
    insertChunk(db, { source: "/a", kind: "plan", text: "seed", embedding: oneHot(0) });
    db.close();
    const reopened = openVecStore({ dim: 8, path: dbFile });
    expect(countChunks(reopened)).toBe(1);
    reopened.close();
  });

  it("dbPath honours KJ_RAG_DB env override", () => {
    const prev = process.env.KJ_RAG_DB;
    process.env.KJ_RAG_DB = "/tmp/x.db";
    try { expect(dbPath()).toBe("/tmp/x.db"); }
    finally { if (prev === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prev; }
  });

  // KJC-TSK-0438 — project isolation
  it("projectSlug normalises projectDir into a stable slug", () => {
    expect(projectSlug("/home/x/karajan-code")).toBe("karajan-code");
    expect(projectSlug("/home/x/My Project/")).toBe("my-project");
    expect(projectSlug("")).toBeNull();
    expect(projectSlug(null)).toBeNull();
  });

  it("insertChunk persists project_slug and searchSimilar filters by it", () => {
    insertChunk(db, { source: "/proja/a", kind: "code", text: "alpha", embedding: oneHot(0), project: "proja" });
    insertChunk(db, { source: "/projb/a", kind: "code", text: "beta", embedding: oneHot(0), project: "projb" });
    insertChunk(db, { source: "/legacy/a", kind: "code", text: "legacy", embedding: oneHot(0) /* no project */ });
    const onlyA = searchSimilar(db, oneHot(0), 5, { project: "proja" });
    expect(onlyA.length).toBe(1);
    expect(onlyA[0].text).toBe("alpha");
    const noFilter = searchSimilar(db, oneHot(0), 5);
    expect(noFilter.length).toBe(3); // pre-migration chunks still queryable
  });

  it("openVecStore migrates old DBs without project_slug column", () => {
    // Recreate without ALTER (simulate v2.26 schema)
    db.close();
    rmSync(dbFile, { force: true });
    const legacy = openVecStore({ dim: 8, path: dbFile });
    // Drop the column to simulate older schema, re-open should re-add it
    legacy.exec("CREATE TABLE temp_chunks AS SELECT id, source, kind, text, metadata, created_at FROM chunks");
    legacy.exec("DROP TABLE chunks");
    legacy.exec("ALTER TABLE temp_chunks RENAME TO chunks");
    legacy.close();
    const migrated = openVecStore({ dim: 8, path: dbFile });
    const cols = migrated.prepare("PRAGMA table_info(chunks)").all().map((c) => c.name);
    expect(cols).toContain("project_slug");
    migrated.close();
  });
});
