import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openVecStore,
  insertChunk,
  searchSimilar,
  countChunks,
  projectSlug,
  deleteChunksBySource,
  findChunkByHash,
  getLastIndexedCommit,
  setLastIndexedCommit,
  dbPath,
} from "../src/vec-store.js";

describe("@karajan/core/vec-store", () => {
  let tmpDir;
  let originalRagDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-vecstore-"));
    originalRagDb = process.env.KJ_RAG_DB;
    process.env.KJ_RAG_DB = path.join(tmpDir, "rag.db");
  });

  afterEach(() => {
    if (originalRagDb === undefined) delete process.env.KJ_RAG_DB;
    else process.env.KJ_RAG_DB = originalRagDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dbPath honours KJ_RAG_DB env", () => {
    expect(dbPath()).toBe(path.join(tmpDir, "rag.db"));
  });

  it("openVecStore initialises chunks + vec_chunks + fts tables", () => {
    const db = openVecStore({ dim: 4 });
    expect(countChunks(db)).toBe(0);
    db.close();
  });

  it("insertChunk + searchSimilar round-trip", () => {
    const db = openVecStore({ dim: 4 });
    const id = insertChunk(db, {
      source: "/a.md",
      kind: "code",
      text: "hola mundo",
      embedding: [1, 0, 0, 0],
    });
    expect(id).toBeGreaterThan(0);
    const hits = searchSimilar(db, [1, 0, 0, 0], 1);
    expect(hits.length).toBe(1);
    expect(hits[0].text).toBe("hola mundo");
    db.close();
  });

  it("deleteChunksBySource removes chunks + vec rows", () => {
    const db = openVecStore({ dim: 4 });
    insertChunk(db, { source: "/x.md", kind: "code", text: "a", embedding: [1, 0, 0, 0] });
    insertChunk(db, { source: "/x.md", kind: "code", text: "b", embedding: [0, 1, 0, 0] });
    expect(deleteChunksBySource(db, "/x.md")).toBe(2);
    expect(countChunks(db)).toBe(0);
    db.close();
  });

  it("projectSlug normalises basenames", () => {
    expect(projectSlug("/home/me/My Project")).toBe("my-project");
    expect(projectSlug("/home/me/karajan-code/")).toBe("karajan-code");
    expect(projectSlug(null)).toBeNull();
  });

  it("findChunkByHash scopes to project", () => {
    const db = openVecStore({ dim: 4 });
    insertChunk(db, {
      source: "/y.md",
      kind: "code",
      text: "hi",
      embedding: [1, 0, 0, 0],
      project: "p1",
      contentHash: "h1",
    });
    expect(findChunkByHash(db, "h1", "p1").source).toBe("/y.md");
    expect(findChunkByHash(db, "h1", "p2")).toBeNull();
    db.close();
  });

  it("get/setLastIndexedCommit persists per-project watermark", () => {
    const db = openVecStore({ dim: 4 });
    expect(getLastIndexedCommit(db, "p1")).toBeNull();
    setLastIndexedCommit(db, "p1", "abc123");
    expect(getLastIndexedCommit(db, "p1")).toBe("abc123");
    setLastIndexedCommit(db, "p1", "def456");
    expect(getLastIndexedCommit(db, "p1")).toBe("def456");
    db.close();
  });
});
