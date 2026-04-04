import { v4 as uuid } from 'uuid';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} boardId
 */
export function listColumns(db, boardId) {
  return db
    .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
    .all(boardId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function getColumn(db, id) {
  return db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ boardId: string, title: string, position?: number }} data
 */
export function createColumn(db, { boardId, title, position }) {
  const id = uuid();
  const pos = position ?? getNextPosition(db, boardId);

  db.prepare(
    'INSERT INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)'
  ).run(id, boardId, title, pos);

  return { id, board_id: boardId, title, position: pos };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} boardId
 */
function getNextPosition(db, boardId) {
  const row = db
    .prepare('SELECT MAX(position) as maxPos FROM columns WHERE board_id = ?')
    .get(boardId);

  return (row?.maxPos ?? -1) + 1;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ title?: string, position?: number }} data
 */
export function updateColumn(db, id, data) {
  const fields = [];
  const values = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.position !== undefined) {
    fields.push('position = ?');
    values.push(data.position);
  }

  if (fields.length === 0) return false;

  values.push(id);
  const result = db
    .prepare(`UPDATE columns SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);

  return result.changes > 0;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function deleteColumn(db, id) {
  const result = db.prepare('DELETE FROM columns WHERE id = ?').run(id);
  return result.changes > 0;
}
