// KJC-TSK-0542: tombstones (KJC-TSK-0380), re-exported by db.js.
// "This (resource_type, resource_id) is dead — don't bring it back." The
// sync layer consults this table BEFORE every upsert and skips records
// whose id is buried. Restoration is explicit via removeTombstone().
import { getDb } from './db-connection.js';

export function addTombstone(resourceType, resourceId, opts = {}) {
  getDb().prepare(`
    INSERT OR REPLACE INTO tombstones (resource_type, resource_id, deleted_at, source, fs_paths)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    resourceType, resourceId,
    new Date().toISOString(),
    opts.source || 'api',
    opts.fsPaths ? JSON.stringify(opts.fsPaths) : null,
  );
}

export function isTombstoned(resourceType, resourceId) {
  return !!getDb().prepare(
    'SELECT 1 FROM tombstones WHERE resource_type = ? AND resource_id = ? LIMIT 1'
  ).get(resourceType, resourceId);
}

/**
 * Read a single tombstone row (or null). Needed so callers can compare
 * `deleted_at` against a resource's own timestamp before deciding whether
 * to revive it (KJC-BUG-0055).
 */
export function getTombstone(resourceType, resourceId) {
  const row = getDb().prepare(
    'SELECT resource_type, resource_id, deleted_at, source, fs_paths FROM tombstones WHERE resource_type = ? AND resource_id = ?'
  ).get(resourceType, resourceId);
  if (!row) return null;
  return { ...row, fs_paths: row.fs_paths ? JSON.parse(row.fs_paths) : [] };
}

export function removeTombstone(resourceType, resourceId) {
  return getDb().prepare(
    'DELETE FROM tombstones WHERE resource_type = ? AND resource_id = ?'
  ).run(resourceType, resourceId).changes > 0;
}

export function listTombstones() {
  return getDb().prepare(
    'SELECT resource_type, resource_id, deleted_at, source, fs_paths FROM tombstones ORDER BY deleted_at DESC'
  ).all().map((row) => ({
    ...row,
    fs_paths: row.fs_paths ? JSON.parse(row.fs_paths) : [],
  }));
}
