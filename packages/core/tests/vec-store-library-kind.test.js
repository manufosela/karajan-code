// KJC-TSK-0697 — the 'library' kind joins the store. Fresh stores accept it
// via the extended CHECK; stores created with the old CHECK rebuild `chunks`
// once, preserving rows, ids and the FTS wiring.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openVecStore, insertChunk, countChunks, searchBM25 } from "../src/vec-store.js";

const DIM = 8;
const vec = (n) => new Array(DIM).fill(n / 10);

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-libkind-"));
  process.env.KJ_RAG_DB = path.join(tmpDir, "rag.db");
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_RAG_DB;
});

describe("vec-store library kind", () => {
  it("a fresh store accepts kind=library", () => {
    const db = openVecStore({ dim: DIM });
    insertChunk(db, { source: "library/lamport.md", kind: "library", text: "happened-before ordering", metadata: {}, embedding: vec(1), project: "library" });
    expect(countChunks(db)).toBe(1);
    db.close();
  });

  it("a store with the pre-library CHECK migrates once, keeping rows and FTS", () => {
    // Hand-build the OLD schema exactly as shipped before this change.
    const raw = new Database(process.env.KJ_RAG_DB);
    raw.exec(`
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('plan', 'code', 'onboarding')),
        text TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chunks (source, kind, text, metadata) VALUES ('src/a.js', 'code', 'legacy chunk body', '{}');
    `);
    raw.close();

    const db = openVecStore({ dim: DIM });
    // Old row survived with its id, and the new kind is accepted.
    expect(db.prepare("SELECT kind, text FROM chunks WHERE id = 1").get()).toMatchObject({ kind: "code", text: "legacy chunk body" });
    insertChunk(db, { source: "library/dynamo.md", kind: "library", text: "vector clocks resolve concurrent writes", metadata: {}, embedding: vec(2), project: "library" });
    expect(countChunks(db)).toBe(2);
    // FTS was rebuilt/rewired: both old and new bodies are searchable.
    expect(searchBM25(db, "legacy", 5, {}).length).toBeGreaterThan(0);
    expect(searchBM25(db, "vector clocks", 5, { kind: "library" }).length).toBeGreaterThan(0);
    // Re-opening does not migrate again (DDL already carries 'library').
    db.close();
    const db2 = openVecStore({ dim: DIM });
    expect(countChunks(db2)).toBe(2);
    db2.close();
  });
});
