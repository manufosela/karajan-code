import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Parse a migration file into up and down sections.
 * @param {string} content - Raw SQL file content
 * @returns {{ up: string, down: string }}
 */
export function parseMigration(content) {
  const parts = content.split('-- Down');
  return {
    up: (parts[0] || '').replace('-- Up', '').trim(),
    down: (parts[1] || '').trim(),
  };
}

/**
 * Ensure the migrations tracking table exists.
 * @param {import('better-sqlite3').Database} db
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Run all pending migrations.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]} Names of applied migrations
 */
export function runMigrations(db) {
  ensureMigrationsTable(db);

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r) => r.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newMigrations = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const { up } = parseMigration(content);

    db.transaction(() => {
      db.exec(up);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();

    newMigrations.push(file);
    logger.info({ migration: file }, 'Migration applied');
  }

  return newMigrations;
}

/**
 * Roll back the last migration.
 * @param {import('better-sqlite3').Database} db
 * @returns {string | null} Name of rolled-back migration
 */
export function rollbackLast(db) {
  ensureMigrationsTable(db);

  const last = db
    .prepare('SELECT name FROM migrations ORDER BY id DESC LIMIT 1')
    .get();

  if (!last) return null;

  const content = readFileSync(
    join(MIGRATIONS_DIR, last.name),
    'utf8'
  );
  const { down } = parseMigration(content);

  db.transaction(() => {
    db.exec(down);
    db.prepare('DELETE FROM migrations WHERE name = ?').run(last.name);
  })();

  logger.info({ migration: last.name }, 'Migration rolled back');
  return last.name;
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  const { getDb, closeDb } = await import('./connection.js');
  const db = getDb();
  const applied = runMigrations(db);
  logger.info({ count: applied.length }, 'Migrations complete');
  closeDb();
}
