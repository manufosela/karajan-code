import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { signAccessToken } from '../src/auth/jwt.js';
import { v4 as uuid } from 'uuid';

/**
 * Create an in-memory test database with migrations applied.
 * @returns {Database.Database}
 */
export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Create a test Express app with the given database.
 * @param {Database.Database} db
 * @returns {import('express').Express}
 */
export function createTestApp(db) {
  return createApp(db);
}

/**
 * Seed a test user and return their data + auth cookie.
 * @param {Database.Database} db
 * @param {{ email?: string, password?: string }} [opts]
 * @returns {Promise<{ user: { id: string, email: string }, cookie: string }>}
 */
export async function seedUser(db, opts = {}) {
  const id = uuid();
  const email = opts.email || `test-${id}@example.com`;
  const password = opts.password || 'TestPass123';
  const passwordHash = await hashPassword(password);

  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash);

  const token = signAccessToken({ id, email });
  return {
    user: { id, email },
    cookie: `access_token=${token}`,
  };
}

/**
 * Seed a board for a user.
 * @param {Database.Database} db
 * @param {string} ownerId
 * @param {string} [title]
 */
export function seedBoard(db, ownerId, title = 'Test Board') {
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO boards (id, title, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, title, ownerId, now, now);
  return { id, title, owner_id: ownerId };
}

/**
 * Seed a column for a board.
 * @param {Database.Database} db
 * @param {string} boardId
 * @param {string} [title]
 * @param {number} [position]
 */
export function seedColumn(db, boardId, title = 'Test Column', position = 0) {
  const id = uuid();
  db.prepare('INSERT INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)').run(id, boardId, title, position);
  return { id, board_id: boardId, title, position };
}

/**
 * Seed a card in a column.
 * @param {Database.Database} db
 * @param {string} columnId
 * @param {string} [title]
 * @param {number} [position]
 */
export function seedCard(db, columnId, title = 'Test Card', position = 0) {
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO cards (id, column_id, title, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, columnId, title, '', position, now, now);
  return { id, column_id: columnId, title, position };
}
