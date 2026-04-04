import { v4 as uuid } from 'uuid';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ email: string, passwordHash: string }} data
 * @returns {{ id: string, email: string, created_at: string }}
 */
export function createUser(db, { email, passwordHash }) {
  const id = uuid();
  db.prepare(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'
  ).run(id, email, passwordHash);

  return { id, email, created_at: new Date().toISOString() };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 */
export function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function findUserById(db, id) {
  return db
    .prepare('SELECT id, email, created_at FROM users WHERE id = ?')
    .get(id);
}
