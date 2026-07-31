// KJC-PCS-0049 Step 1 — Vector store sobre better-sqlite3 + sqlite-vec.
// El RAG indexer (Step 4) escribe; el retriever (Step 5) lee. Una sola
// DB en `~/.karajan/rag.db` por instalación.
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import { getKarajanHome } from "./paths.js";

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
      kind TEXT NOT NULL CHECK (kind IN ('plan', 'code', 'onboarding', 'library')),
      text TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS chunks_by_source ON chunks(source);
    CREATE INDEX IF NOT EXISTS chunks_by_kind ON chunks(kind);
  `);
  // KJC-TSK-0438 — Project isolation. project_slug = basename of projectDir
  // normalized; chunks indexed before the migration carry NULL and remain
  // queryable when `--project all` (or no slug detected at query time).
  const cols = db.prepare("PRAGMA table_info(chunks)").all().map((c) => c.name);
  if (!cols.includes("project_slug")) {
    db.exec("ALTER TABLE chunks ADD COLUMN project_slug TEXT;");
    db.exec("CREATE INDEX IF NOT EXISTS chunks_by_project ON chunks(project_slug);");
  }
  // KJC-TSK-0484 — Content-hash dedup. SHA-256 of the chunk text lets the
  // indexer skip embedding bodies it has already seen for the same project.
  // Older rows keep NULL; the lookup ignores NULLs so they neither dedup
  // nor get deduped until they are re-indexed and stamped.
  if (!cols.includes("content_hash")) {
    db.exec("ALTER TABLE chunks ADD COLUMN content_hash TEXT;");
    db.exec("CREATE INDEX IF NOT EXISTS chunks_by_hash ON chunks(content_hash, project_slug);");
  }
  // KJC-TSK-0697 — the 'library' kind (distilled engineering canon) joins
  // the store. SQLite cannot alter a CHECK constraint, so stores created
  // before it rebuild `chunks` once: ids are preserved (the external-content
  // FTS keeps pointing at the same rowids) and the fts triggers, dropped
  // with the old table, are recreated by the block below.
  const chunksDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks'").get()?.sql ?? "";
  let migratedChunksTable = false;
  if (chunksDdl.includes("'onboarding'") && !chunksDdl.includes("'library'")) {
    migratedChunksTable = true;
    db.exec(`
      DROP TRIGGER IF EXISTS chunks_ai;
      DROP TRIGGER IF EXISTS chunks_ad;
      DROP TRIGGER IF EXISTS chunks_au;
      CREATE TABLE chunks_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('plan', 'code', 'onboarding', 'library')),
        text TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        project_slug TEXT,
        content_hash TEXT
      );
      INSERT INTO chunks_migrated (id, source, kind, text, metadata, created_at, project_slug, content_hash)
        SELECT id, source, kind, text, metadata, created_at, project_slug, content_hash FROM chunks;
      DROP TABLE chunks;
      ALTER TABLE chunks_migrated RENAME TO chunks;
      CREATE INDEX IF NOT EXISTS chunks_by_source ON chunks(source);
      CREATE INDEX IF NOT EXISTS chunks_by_kind ON chunks(kind);
      CREATE INDEX IF NOT EXISTS chunks_by_project ON chunks(project_slug);
      CREATE INDEX IF NOT EXISTS chunks_by_hash ON chunks(content_hash, project_slug);
    `);
  }
  // KJC-TSK-0455 — Auto-update by commit diff. Per-project metadata tracks
  // the last commit whose changes were reflected in the index, so subsequent
  // `kj rag index --since auto` invocations (and the post-merge hook / pre-run
  // drift check landed in PR2) only re-embed the actual delta instead of the
  // whole project.
  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_store_meta (
      project_slug TEXT PRIMARY KEY,
      last_indexed_commit TEXT,
      last_indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}]);`);
  // KJC-TSK-0443 — FTS5 keyword index for BM25 hybrid scoring. content='chunks'
  // makes it a contentless mirror linked by id (no double storage); triggers
  // sync the FTS5 rows on insert/update/delete. Rebuilds idempotently when
  // the FTS5 table exists but is empty (e.g. created post-migration on a
  // DB with pre-v2.28 chunks).
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `);
  const ftsCount = db.prepare("SELECT COUNT(*) AS n FROM chunks_fts").get().n;
  const chunksCount = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
  // On external-content FTS5, COUNT(*) reads through the content table, so
  // it cannot detect an empty INDEX — after the chunks-table rebuild the
  // index is stale by construction and must be rebuilt explicitly.
  if (migratedChunksTable || (ftsCount === 0 && chunksCount > 0)) {
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');");
  }
  return db;
}

/**
 * Persist one chunk. The chunks.id and vec_chunks.rowid stay in sync
 * because the virtual table rowid is set explicitly to the freshly
 * minted chunks.id. Returns that id.
 */
export function insertChunk(db, { source, kind, text, metadata = null, embedding, project = null, contentHash = null }) {
  if (!Array.isArray(embedding) && !ArrayBuffer.isView(embedding)) {
    throw new Error("insertChunk: embedding must be an array or typed array of floats");
  }
  const meta = metadata == null ? null : (typeof metadata === "string" ? metadata : JSON.stringify(metadata));
  const ins = db.prepare("INSERT INTO chunks (source, kind, text, metadata, project_slug, content_hash) VALUES (?, ?, ?, ?, ?, ?)");
  const info = ins.run(source, kind, text, meta, project, contentHash);
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
export function searchSimilar(db, embedding, topK = 5, { kind = null, project = null, whereSql = "", whereParams = [] } = {}) {
  const buf = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding);
  const kindClause = kind ? "AND c.kind = ?" : "";
  const projectClause = project ? "AND c.project_slug = ?" : "";
  const sql = `
    SELECT c.id, c.source, c.kind, c.text, c.metadata, c.project_slug, v.distance
    FROM vec_chunks v
    JOIN chunks c ON c.id = v.rowid
    WHERE v.embedding MATCH ? AND k = ? ${kindClause} ${projectClause}${whereSql}
    ORDER BY v.distance
  `;
  const params = [Buffer.from(buf.buffer), topK];
  if (kind) params.push(kind);
  if (project) params.push(project);
  if (whereParams.length) params.push(...whereParams);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, metadata: r.metadata ? safeParse(r.metadata) : null }));
}

/**
 * Normalize a projectDir into a stable slug used for project isolation.
 * Basename → lowercased → non-alphanumeric stripped to dashes.
 * KJC-TSK-0438.
 */
export function projectSlug(projectDir) {
  if (!projectDir) return null;
  const base = String(projectDir).replace(/\/+$/, "").split("/").pop();
  if (!base) return null;
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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

// KJC-TSK-0455 — Per-project commit watermark for `kj rag index --since auto`
// and the post-merge / pre-run drift hooks landing in PR2.
export function getLastIndexedCommit(db, projectSlug) {
  if (!projectSlug) return null;
  const row = db.prepare("SELECT last_indexed_commit FROM vec_store_meta WHERE project_slug = ?").get(projectSlug);
  return row?.last_indexed_commit ?? null;
}

export function setLastIndexedCommit(db, projectSlug, commit) {
  if (!projectSlug || !commit) return;
  db.prepare(`
    INSERT INTO vec_store_meta (project_slug, last_indexed_commit, last_indexed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(project_slug) DO UPDATE SET
      last_indexed_commit = excluded.last_indexed_commit,
      last_indexed_at = excluded.last_indexed_at
  `).run(projectSlug, commit);
}

// KJC-TSK-0484 PR-B — Bulk fetch embeddings for an explicit set of chunk ids.
// Returns Map<id, Float32Array>. Used by MMR diversification in retriever.js.
export function getEmbeddingsByIds(db, ids) {
  const out = new Map();
  if (!ids?.length) return out;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT rowid AS id, embedding FROM vec_chunks WHERE rowid IN (${placeholders})`).all(...ids);
  for (const row of rows) {
    if (!row.embedding) continue;
    const buf = Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding);
    out.set(Number(row.id), new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  }
  return out;
}

// KJC-TSK-0484 — Lookup an already-indexed chunk by content_hash. Scoped to a
// project so two repos with the same boilerplate file don't cross-pollute.
// Returns `{ id, source }` or null. Pass `project=null` to match NULL slugs.
export function findChunkByHash(db, hash, project = null) {
  if (!hash) return null;
  const sql = project
    ? "SELECT id, source FROM chunks WHERE content_hash = ? AND project_slug = ? LIMIT 1"
    : "SELECT id, source FROM chunks WHERE content_hash = ? AND project_slug IS NULL LIMIT 1";
  const row = project ? db.prepare(sql).get(hash, project) : db.prepare(sql).get(hash);
  return row || null;
}

export function countChunks(db, { kind = null } = {}) {
  if (kind) return db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE kind = ?").get(kind).n;
  return db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
}

/**
 * KJC-TSK-0443 — BM25 keyword search over chunks_fts. Returns
 * [{ id, source, kind, text, metadata, project_slug, bm25 }] ordered by
 * relevance (lower bm25 = better in SQLite FTS5). `query` is sanitized for
 * the FTS5 grammar: special chars are stripped, words split on whitespace.
 */
export function searchBM25(db, queryText, topK = 10, { kind = null, project = null, whereSql = "", whereParams = [] } = {}) {
  const cleaned = String(queryText || "").replace(/["'()]/g, " ").split(/\s+/).filter(Boolean).join(" OR ");
  if (!cleaned) return [];
  const kindClause = kind ? "AND c.kind = ?" : "";
  const projectClause = project ? "AND c.project_slug = ?" : "";
  const sql = `
    SELECT c.id, c.source, c.kind, c.text, c.metadata, c.project_slug, bm25(chunks_fts) AS bm25
    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
    WHERE chunks_fts MATCH ? ${kindClause} ${projectClause}${whereSql}
    ORDER BY bm25 LIMIT ?
  `;
  const params = [cleaned];
  if (kind) params.push(kind);
  if (project) params.push(project);
  if (whereParams.length) params.push(...whereParams);
  params.push(topK);
  try {
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => ({ ...r, metadata: r.metadata ? safeParse(r.metadata) : null }));
  } catch { return []; }
}
