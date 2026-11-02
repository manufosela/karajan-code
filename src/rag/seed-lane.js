// HU-2755 (1/2): a new lane starts from a copy of the main checkout's index instead of a full bootstrap.
// Vectors are lane-independent (repo-relative embed header): only paths, slug and watermark change, and the
// delta refresh that follows closes the gap between main's commit and the lane.
import { existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import { projectDbPath } from "./project-store.js";
import { openVecStore, projectSlug, getLastIndexedCommit } from "./vec-store.js";
import { EMBED_SCHEMA } from "./embed-header.js";
import { readEmbedSchema, writeEmbedSchema } from "./embed-schema.js";
import { readRefreshedPaths, writeRefreshedPaths } from "./worktree-files.js";

const refuse = (reason) => ({ seeded: false, reason });

/** Dim baked into vec_chunks' DDL, or null. */
export function storeDim(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_chunks'").get()?.sql ?? "";
  return Number(/float\[(\d+)\]/.exec(sql)?.[1]) || null;
}

/** One transaction on a copy: drops rows outside `fromRoot`, moves the rest to `toRoot`/`toSlug`. */
export function rewriteForLane(db, { fromRoot, toRoot, fromSlug, toSlug }) {
  const [old, neo] = [`${fromRoot}/`, `${toRoot}/`];
  const auSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'chunks_au'").get()?.sql;
  const total = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
  return db.transaction(() => {
    const outside = db.prepare("SELECT id FROM chunks WHERE substr(source, 1, length(?)) <> ?").all(old, old).map((r) => r.id);
    const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
    const delChunk = db.prepare("DELETE FROM chunks WHERE id = ?");
    outside.forEach((id) => { delVec.run(BigInt(id)); delChunk.run(id); });
    // chunks_au re-tokenizes the row on any UPDATE, and FTS only indexes `text`: suspend it.
    db.exec("DROP TRIGGER IF EXISTS chunks_au");
    db.prepare(`UPDATE chunks SET
      source = :neo || substr(source, length(:old) + 1),
      project_slug = :toSlug,
      metadata = CASE WHEN json_valid(metadata) AND json_type(metadata, '$.source') = 'text'
                       AND substr(json_extract(metadata, '$.source'), 1, length(:old)) = :old
                  THEN json_set(metadata, '$.source', :neo || substr(json_extract(metadata, '$.source'), length(:old) + 1))
                  ELSE metadata END`).run({ old, neo, toSlug });
    if (auSql) db.exec(auSql);
    db.prepare("DELETE FROM vec_store_meta WHERE project_slug <> ?").run(fromSlug);
    db.prepare("UPDATE vec_store_meta SET project_slug = ? WHERE project_slug = ?").run(toSlug, fromSlug);
    return { kept: total - outside.length, dropped: outside.length };
  })();
}

/** Never throws. { seeded: true, chunks, commit } | { seeded: false, reason } */
export async function seedLaneIndex({ mainDir, laneDir, dim = 768 } = {}) {
  if (process.env.KJ_RAG_DB) return refuse("shared-db");
  const mainDb = projectDbPath(mainDir);
  const laneDb = projectDbPath(laneDir);
  if (existsSync(laneDb)) return refuse("lane-has-index");
  if (!existsSync(mainDb)) return refuse("no-main-index");
  const tmp = `${laneDb}.seed-${process.pid}`;
  let src;
  try {
    src = new Database(mainDb, { readonly: true, fileMustExist: true });
    sqliteVec.load(src);
    const fromSlug = projectSlug(mainDir);
    const commit = getLastIndexedCommit(src, fromSlug);
    if (!commit) return refuse("no-watermark");
    const schema = readEmbedSchema(mainDir);
    if (schema < EMBED_SCHEMA) return refuse("embed-schema-old");
    if (storeDim(src) !== dim) return refuse("dim-mismatch");
    mkdirSync(dirname(laneDb), { recursive: true });
    rmSync(tmp, { force: true });
    src.prepare("VACUUM INTO ?").run(tmp);
    const db = openVecStore({ dim, path: tmp });
    let stats;
    try {
      stats = rewriteForLane(db, { fromRoot: mainDir, toRoot: laneDir, fromSlug, toSlug: projectSlug(laneDir) });
      db.pragma("journal_mode = DELETE");
    } finally {
      db.close();
    }
    if (stats.kept === 0 || stats.dropped > stats.kept) return refuse("paths-unmatched");
    // link throws EEXIST rather than clobber a concurrent index; markers follow (a crash between = schema 1, fails safe)
    linkSync(tmp, laneDb);
    writeEmbedSchema(laneDir, schema);
    const paths = readRefreshedPaths(mainDir);
    if (paths.length) writeRefreshedPaths(laneDir, paths);
    return { seeded: true, chunks: stats.kept, commit };
  } catch {
    return refuse("error");
  } finally {
    src?.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${tmp}${suffix}`, { force: true });
  }
}
