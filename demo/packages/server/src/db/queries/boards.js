import { v4 as uuid } from 'uuid';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} ownerId
 */
export function listBoards(db, ownerId) {
  return db
    .prepare('SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at DESC')
    .all(ownerId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {string} ownerId
 */
export function getBoard(db, id, ownerId) {
  return db
    .prepare('SELECT * FROM boards WHERE id = ? AND owner_id = ?')
    .get(id, ownerId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ title: string, ownerId: string }} data
 */
export function createBoard(db, { title, ownerId }) {
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO boards (id, title, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title, ownerId, now, now);

  return { id, title, owner_id: ownerId, created_at: now, updated_at: now };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {string} ownerId
 * @param {{ title: string }} data
 */
export function updateBoard(db, id, ownerId, { title }) {
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(title, now, id, ownerId);

  return result.changes > 0;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {string} ownerId
 */
export function deleteBoard(db, id, ownerId) {
  const result = db
    .prepare('DELETE FROM boards WHERE id = ? AND owner_id = ?')
    .run(id, ownerId);

  return result.changes > 0;
}
