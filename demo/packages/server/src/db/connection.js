import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

/** @type {Database.Database | null} */
let db = null;

/**
 * Get or create the database connection.
 * @param {string} [dbPath] - Path to the SQLite file. Defaults to env DB_PATH.
 * @returns {Database.Database}
 */
export function getDb(dbPath) {
  if (db) return db;

  const resolvedPath = dbPath || process.env.DB_PATH || './data/taskboard.db';
  mkdirSync(dirname(resolvedPath), { recursive: true });

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info({ path: resolvedPath }, 'Database connected');
  return db;
}

/**
 * Close and reset the database connection.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create an in-memory database for testing.
 * @returns {Database.Database}
 */
export function createTestDb() {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  return testDb;
}
