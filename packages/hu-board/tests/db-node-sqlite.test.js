import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// KJC-TSK-0617 (SQL-C): the board's DB runs on the node:sqlite adapter (karajan-core/db), no native
// addon. Loading better-sqlite3 at all is a failure.
vi.mock('better-sqlite3', () => {
  throw new Error('better-sqlite3 must not be loaded by the board');
});

let home;
let conn;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'hu-board-sqlite-'));
  process.env.KJ_HOME = home;
  conn = await import('../src/db-connection.js');
});

afterEach(() => {
  conn?.closeDb();
  rmSync(home, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe('board DB on node:sqlite', () => {
  it('creates the schema and round-trips a row', () => {
    const db = conn.initDb();
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('p1', 'One');
    expect(db.prepare('SELECT name FROM projects WHERE id = ?').get('p1')).toEqual({ name: 'One' });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('moves a corrupt DB aside and opens a fresh one', () => {
    writeFileSync(join(home, 'hu-board.db'), 'this is not a sqlite file at all, just text');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = conn.initDb();
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 0 });
    expect(readdirSync(home).some((f) => f.startsWith('hu-board.db.corrupt-'))).toBe(true);
    warn.mockRestore();
  });
});
