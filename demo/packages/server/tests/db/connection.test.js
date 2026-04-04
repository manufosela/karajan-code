import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers.js';

describe('Database connection', () => {
  it('creates an in-memory database with foreign keys enabled', () => {
    const db = createTestDb();
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it('has all expected tables after migrations', () => {
    const db = createTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    expect(tables).toContain('users');
    expect(tables).toContain('boards');
    expect(tables).toContain('columns');
    expect(tables).toContain('cards');
    expect(tables).toContain('migrations');
    db.close();
  });
});
