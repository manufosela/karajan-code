/**
 * RAG vector-store orphan collector — KJC-TSK-0499 PR2.
 *
 * Enumerates distinct `project_slug` rows in `~/.karajan/rag.db`,
 * augments each with chunk count + last_indexed_{at,commit}, and
 * marks as orphan the slugs whose basename does not resolve to a
 * directory in any of the configured `projectRoots`.
 *
 * Read-only. Returns rows + a copy-paste sqlite3 command per orphan.
 * Deliberate inverse of the RAG indexer: never opens the DB for write.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { dbPath, openVecStore, projectSlug } from "../rag/vec-store.js";

const DEFAULT_ROOTS = [
  path.join(os.homedir(), "ws_npm-packages"),
  path.join(os.homedir(), "ws_firebase"),
  path.join(os.homedir(), "projects"),
  path.join(os.homedir(), "code"),
];

async function listDirs(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

async function buildSlugIndex(roots) {
  const index = new Map();
  for (const root of roots) {
    for (const dir of await listDirs(root)) {
      const slug = projectSlug(dir);
      if (slug && !index.has(slug)) index.set(slug, dir);
    }
  }
  return index;
}

function purgeCommand(slug) {
  const slugSafe = slug.replace(/'/g, "''");
  return `sqlite3 ${dbPath()} "DELETE FROM chunks WHERE project_slug='${slugSafe}'; DELETE FROM vec_store_meta WHERE project_slug='${slugSafe}';"`;
}

/**
 * Collect RAG vector-store orphans.
 * @param {object} [opts]
 * @param {string[]} [opts.projectRoots] — directories to look for live
 *   projects whose basename matches each slug. Defaults to the usual
 *   `~/ws_*`, `~/projects`, `~/code` set.
 * @returns {Promise<{rows: Array, orphans: Array, errors: Array}>}
 */
export async function collectVectorStoreOrphans({ projectRoots = DEFAULT_ROOTS } = {}) {
  const rows = [];
  const errors = [];
  let db;
  try { db = openVecStore(); } catch (e) {
    return { rows, orphans: [], errors: [{ stage: "open", error: String(e?.message ?? e) }] };
  }
  try {
    const stats = db.prepare(`
      SELECT COALESCE(c.project_slug, '<null>') AS slug,
             COUNT(c.id) AS chunkCount,
             COALESCE(m.last_indexed_commit, '') AS lastCommit,
             COALESCE(m.last_indexed_at, '') AS lastAt
      FROM chunks c
      LEFT JOIN vec_store_meta m ON m.project_slug = c.project_slug
      GROUP BY c.project_slug
      ORDER BY chunkCount DESC
    `).all();
    const slugIndex = await buildSlugIndex(projectRoots);
    for (const r of stats) {
      const resolved = slugIndex.get(r.slug) || null;
      rows.push({ ...r, resolvedDir: resolved, orphan: !resolved && r.slug !== "<null>" });
    }
  } catch (e) {
    errors.push({ stage: "query", error: String(e?.message ?? e) });
  } finally {
    try { db.close(); } catch { /* close errors are non-fatal */ }
  }
  const orphans = rows
    .filter((r) => r.orphan)
    .map((r) => ({ ...r, command: purgeCommand(r.slug) }));
  return { rows, orphans, errors };
}
