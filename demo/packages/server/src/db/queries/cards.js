import { v4 as uuid } from 'uuid';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} columnId
 */
export function listCards(db, columnId) {
  return db
    .prepare('SELECT * FROM cards WHERE column_id = ? ORDER BY position ASC')
    .all(columnId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function getCard(db, id) {
  return db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ columnId: string, title: string, description?: string, position?: number }} data
 */
export function createCard(db, { columnId, title, description, position }) {
  const id = uuid();
  const now = new Date().toISOString();
  const pos = position ?? getNextPosition(db, columnId);
  const desc = description || '';

  db.prepare(
    'INSERT INTO cards (id, column_id, title, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, columnId, title, desc, pos, now, now);

  return { id, column_id: columnId, title, description: desc, position: pos, created_at: now, updated_at: now };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} columnId
 */
function getNextPosition(db, columnId) {
  const row = db
    .prepare('SELECT MAX(position) as maxPos FROM cards WHERE column_id = ?')
    .get(columnId);

  return (row?.maxPos ?? -1) + 1;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ title?: string, description?: string }} data
 */
export function updateCard(db, id, data) {
  const fields = ['updated_at = ?'];
  const values = [new Date().toISOString()];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    fields.push('description = ?');
    values.push(data.description);
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);

  return result.changes > 0;
}

/**
 * Move a card to a new column and position (atomic reorder).
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ columnId: string, position: number }} target
 */
export function moveCard(db, id, { columnId, position }) {
  const card = getCard(db, id);
  if (!card) return null;

  const move = db.transaction(() => {
    // Shift cards down in target column to make room
    db.prepare(
      'UPDATE cards SET position = position + 1 WHERE column_id = ? AND position >= ?'
    ).run(columnId, position);

    // If same column, adjust gap from removal
    if (card.column_id === columnId) {
      db.prepare(
        'UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?'
      ).run(card.column_id, card.position);
    } else {
      // Close gap in source column
      db.prepare(
        'UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?'
      ).run(card.column_id, card.position);
    }

    // Move the card
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?'
    ).run(columnId, position, now, id);

    return getCard(db, id);
  });

  return move();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function deleteCard(db, id) {
  const card = getCard(db, id);
  if (!card) return false;

  return db.transaction(() => {
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    // Close gap
    db.prepare(
      'UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?'
    ).run(card.column_id, card.position);
    return true;
  })();
}
