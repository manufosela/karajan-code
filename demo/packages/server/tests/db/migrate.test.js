import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, parseMigration, rollbackLast } from '../../src/db/migrate.js';

describe('Database migrations', () => {
  it('parses migration file into up and down', () => {
    const content = '-- Up\nCREATE TABLE test (id TEXT);\n-- Down\nDROP TABLE test;';
    const { up, down } = parseMigration(content);
    expect(up).toContain('CREATE TABLE');
    expect(down).toContain('DROP TABLE');
  });

  it('applies migrations to a fresh database', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const applied = runMigrations(db);
    expect(applied.length).toBeGreaterThan(0);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).toContain('users');
    expect(tables).toContain('boards');
    expect(tables).toContain('columns');
    expect(tables).toContain('cards');
    db.close();
  });

  it('does not re-apply already applied migrations', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.length).toBe(0);
    db.close();
  });

  it('rolls back the last migration', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const rolledBack = rollbackLast(db);
    expect(rolledBack).toBeTruthy();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).not.toContain('users');
    db.close();
  });
});
