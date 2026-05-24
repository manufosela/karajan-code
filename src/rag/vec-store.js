// KJC-PCS-0049 Step 1 — Vector store sobre better-sqlite3 + sqlite-vec.
// El RAG indexer (Step 4) escribe; el retriever (Step 5) lee. Una sola
// DB en `~/.karajan/rag.db` por instalación.
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import { getKarajanHome } from "../utils/paths.js";

const DEFAULT_DIM = 768;

export function dbPath() {
  return process.env.KJ_RAG_DB || join(getKarajanHome(), "rag.db");
}

/**
 * Open the rag.db, load the sqlite-vec extension, and ensure the
 * chunks + vec_chunks tables exist. Idempotent: a second call against
 * the same file is a no-op past the schema creation.
 *
 * Returns the open Database handle. Caller owns close().
 *
 * @param {Object} [opts]
 * @param {number} [opts.dim=768] — embedding dimension. Must match
 *   the embedder configured for the project (Step 2). Changing it
 *   later requires a fresh DB; the constant is captured in the
 *   virtual table DDL.
 */
export function openVecStore({ dim = DEFAULT_DIM, path = dbPath() } = {}) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('plan', 'code', 'onboarding')),
      text TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS chunks_by_source ON chunks(source);
    CREATE INDEX IF NOT EXISTS chunks_by_kind ON chunks(kind);
  `);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}]);`);
  return db;
}

/**
 * Persist one chunk. The chunks.id and vec_chunks.rowid stay in sync
 * because the virtual table rowid is set explicitly to the freshly
 * minted chunks.id. Returns that id.
 */
export function insertChunk(db, { source, kind, text, metadata = null, embedding }) {
  if (!Array.isArray(embedding) && !ArrayBuffer.isView(embedding)) {
    throw new Error("insertChunk: embedding must be an array or typed array of floats");
  }
  const meta = metadata == null ? null : (typeof metadata === "string" ? metadata : JSON.stringify(metadata));
  const ins = db.prepare("INSERT INTO chunks (source, kind, text, metadata) VALUES (?, ?, ?, ?)");
  const info = ins.run(source, kind, text, meta);
  // sqlite-vec's vec0 virtual table requires the rowid to arrive as a BigInt
  // even for values that comfortably fit in a Number. Better-sqlite3 returns
  // lastInsertRowid as BigInt only when safeIntegers mode is on; force it.
  const id = typeof info.lastInsertRowid === "bigint" ? info.lastInsertRowid : BigInt(info.lastInsertRowid);
  const buf = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding);
  db.prepare("INSERT INTO vec_chunks(rowid, embedding) VALUES (?, ?)").run(id, Buffer.from(buf.buffer));
  return Number(id);
}

/**
 * Cosine-ordered nearest-neighbour search. Returns `[{ id, source, kind,
 * text, metadata, distance }]` for the topK best matches; lower
 * distance = closer. Returns `[]` when the store is empty.
 */
export function searchSimilar(db, embedding, topK = 5, { kind = null } = {}) {
  const buf = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding);
  const kindClause = kind ? "AND c.kind = ?" : "";
  const sql = `
    SELECT c.id, c.source, c.kind, c.text, c.metadata, v.distance
    FROM vec_chunks v
    JOIN chunks c ON c.id = v.rowid
    WHERE v.embedding MATCH ? AND k = ? ${kindClause}
    ORDER BY v.distance
  `;
  const params = [Buffer.from(buf.buffer), topK];
  if (kind) params.push(kind);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, metadata: r.metadata ? safeParse(r.metadata) : null }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

/**
 * Remove every chunk that came from a given source path. Both tables
 * are touched explicitly because vec0 virtual tables do not honour
 * SQLite foreign-key cascades.
 */
export function deleteChunksBySource(db, source) {
  const ids = db.prepare("SELECT id FROM chunks WHERE source = ?").all(source).map((r) => r.id);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM vec_chunks WHERE rowid IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...ids);
  return ids.length;
}

export function countChunks(db, { kind = null } = {}) {
  if (kind) return db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE kind = ?").get(kind).n;
  return db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
}
