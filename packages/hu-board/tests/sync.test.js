import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-sync-'));
  process.env.KJ_HOME = tmpDir;
});

afterEach(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

async function setup() {
  const db = await import('../src/db.js');
  db.initDb();
  const sync = await import('../src/sync.js');
  return { db, sync };
}

// ---------------------------------------------------------------------------
// The retired kj run store (KJC-TSK-1347)
// ---------------------------------------------------------------------------
describe('hu-stories is no longer read', () => {
  it('a batch.json left in ~/.karajan/hu-stories is neither imported nor deleted', async () => {
    const { db, sync } = await setup();
    const sessionDir = join(tmpDir, 'hu-stories', 'sess-001');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'batch.json'), JSON.stringify({ session_id: 'sess-001', project_id: 'proj-alpha', stories: [{ id: 'hu-001', status: 'pending' }] }));

    sync.fullScan();

    expect(db.getProjects().find((p) => p.id === 'proj-alpha')).toBeUndefined();
    expect(existsSync(join(sessionDir, 'batch.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parsing session.json
// ---------------------------------------------------------------------------
describe('syncSessionFile via fullScan', () => {
  it('parses a valid session.json and syncs to db', async () => {
    const { db, sync } = await setup();

    const sessionDir = join(tmpDir, 'sessions', 'sess-100');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        id: 'sess-100',
        project_id: 'proj-beta',
        task: 'Fix login bug',
        status: 'approved',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T01:00:00Z',
        checkpoints: [
          { iteration: 1, stage: 'coder' },
          { iteration: 2, stage: 'reviewer' },
          { iteration: 2, stage: 'checkpoint-2' },
        ],
        commits: [{ hash: 'abc123', message: 'fix: login' }],
        budget: { maxIterations: 5 },
      })
    );

    sync.fullScan();

    // Session synced
    const sessions = db.getSessionsByProject('proj-beta');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('sess-100');
    expect(sessions[0].status).toBe('approved');
    expect(sessions[0].iterations).toBe(2); // max iteration from checkpoints

    // Duration calculated from created_at and updated_at
    const detail = db.getDb().prepare('SELECT * FROM sessions WHERE id = ?').get('sess-100');
    expect(detail.duration_ms).toBe(3600000); // 1 hour
    expect(detail.approved).toBe(1);

    // stages_completed excludes checkpoint/attempt stages
    const stages = JSON.parse(detail.stages_completed);
    expect(stages).toContain('coder');
    expect(stages).toContain('reviewer');
    expect(stages).not.toContain('checkpoint-2');
  });

  it('extracts project_id from session data', async () => {
    const { db, sync } = await setup();

    const sessionDir = join(tmpDir, 'sessions', 'sess-200');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        id: 'sess-200',
        project_id: 'proj-gamma',
        task: 'Add tests',
        status: 'running',
        created_at: '2026-03-01T00:00:00Z',
        checkpoints: [],
      })
    );

    sync.fullScan();

    const sessions = db.getSessionsByProject('proj-gamma');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].project_id).toBe('proj-gamma');

    // Also ensures the project was created
    const projects = db.getProjects();
    expect(projects.find((p) => p.id === 'proj-gamma')).toBeTruthy();
  });

  it('handles malformed session.json gracefully', async () => {
    const { sync } = await setup();

    const sessionDir = join(tmpDir, 'sessions', 'bad-sess');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), 'not json at all');

    expect(() => sync.fullScan()).not.toThrow();
  });

  it('handles missing sessions directory gracefully', async () => {
    const { sync } = await setup();
    // sessions dir does not exist — fullScan should not throw
    expect(() => sync.fullScan()).not.toThrow();
  });

  it('rejects (does not ingest) sessions without project_id and no matching batch', async () => {
    // PR-B (orphan-proof): the previous behaviour was to promote orphan
    // sessions to a fake "default" / "Orphan sessions" project. The user
    // declared that invariant unacceptable: "ES IMPOSIBLE QUE OCURRA. Si
    // se crea proyecto y se crean hus se asocian a proyecto". sync.js now
    // skips orphan session.json files entirely; the "default" project
    // never appears.
    const { db, sync } = await setup();

    const sessionDir = join(tmpDir, 'sessions', 'sess-noproject');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        id: 'sess-noproject',
        task: 'Orphan task',
        status: 'failed',
        checkpoints: [],
      })
    );

    sync.fullScan();

    // The orphan session must NOT have created a "default" project.
    const allProjects = db.getProjects();
    expect(allProjects.find((p) => p.id === 'default')).toBeUndefined();

    // And the session itself must not have been ingested anywhere.
    const sessions = db.getSessionsByProject('default');
    expect(sessions.find((s) => s.id === 'sess-noproject')).toBeUndefined();
  });
});
