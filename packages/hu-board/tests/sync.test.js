import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
// Parsing batch.json (story files)
// ---------------------------------------------------------------------------
describe('syncStoryFile via fullScan', () => {
  it('parses a valid batch.json and syncs stories to db', async () => {
    const { db, sync } = await setup();

    const sessionDir = join(tmpDir, 'hu-stories', 'sess-001');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'batch.json'),
      JSON.stringify({
        session_id: 'sess-001',
        project_id: 'proj-alpha',
        project_name: 'Alpha',
        created_at: '2026-01-01T00:00:00Z',
        stories: [
          {
            id: 'hu-001',
            status: 'certified',
            original: { text: 'As a user I want login' },
            certified: { as: 'a user', want: 'login via SSO', so_that: 'I save time' },
            quality: { total: 92, dimensions: { d1: 90, d2: 95, d3: 88, d4: 92, d5: 90, d6: 97 } },
            acceptance_criteria: { format: 'gherkin', criteria: [{ given: 'logged out', when: 'click SSO', then: 'logged in' }] },
            context_requests: [{ question: 'Which IdP?', answer: 'Azure AD', requested_at: '2026-01-01T00:00:00Z' }],
          },
          {
            id: 'hu-002',
            status: 'pending',
            original: { text: 'As admin I want reports' },
          },
        ],
      })
    );

    sync.fullScan();

    // Projects synced
    const projects = db.getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const alpha = projects.find((p) => p.id === 'proj-alpha');
    expect(alpha).toBeTruthy();
    expect(alpha.name).toBe('Alpha');

    // Stories synced
    const stories = db.getStoriesByProject('proj-alpha');
    expect(stories).toHaveLength(2);

    const hu001 = db.getStoryDetail('hu-001');
    expect(hu001.status).toBe('certified');
    expect(hu001.certified_as).toBe('a user');
    expect(hu001.quality_total).toBe(92);
    expect(hu001.context_requests).toHaveLength(1);
    expect(hu001.context_requests[0].question).toBe('Which IdP?');

    const hu002 = db.getStoryDetail('hu-002');
    expect(hu002.status).toBe('pending');
  });

  it('handles malformed batch.json gracefully (no crash)', async () => {
    const { sync } = await setup();

    const sessionDir = join(tmpDir, 'hu-stories', 'bad-session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'batch.json'), '{ invalid json !!!');

    // Should not throw — the sync function catches errors internally
    expect(() => sync.fullScan()).not.toThrow();
  });

  it('handles missing stories directory gracefully', async () => {
    const { sync } = await setup();
    // hu-stories dir does not exist — should not throw
    expect(() => sync.fullScan()).not.toThrow();
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

  it('defaults project_id to "default" when missing from session data', async () => {
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

    const sessions = db.getSessionsByProject('default');
    const found = sessions.find((s) => s.id === 'sess-noproject');
    expect(found).toBeTruthy();
    expect(found.project_id).toBe('default');
  });
});
