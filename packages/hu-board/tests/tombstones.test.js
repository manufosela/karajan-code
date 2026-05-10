/**
 * KJC-TSK-0380 — Tombstones: "deleted, do not resurrect".
 *
 * Verifies the contract the rest of the board now relies on:
 *  - addTombstone + isTombstoned + removeTombstone round-trip.
 *  - sync functions (story/session/plan) bail out on tombstoned ids.
 *  - DELETE /api/projects/:id tombstones the project AND its children.
 *  - DELETE /api/prompts/:id tombstones the prompt and removes fs files.
 *  - GET /api/prompts hides tombstoned prompts even if files remain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let tmpDir;
let dbMod, syncMod;
let app;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-tomb-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, '.kj', 'plans');

  // Vitest caches modules per test process; resetting per-test would be
  // overkill, so we rely on a fresh KJ_HOME per test + closeDb at teardown.
  dbMod = await import('../src/db.js');
  dbMod.initDb();
  syncMod = await import('../src/sync.js');

  const { default: apiRoutes } = await import('../src/routes/api.js');
  app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
});

afterEach(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

// ---------- db-layer contract -------------------------------------------------

describe('tombstones — db layer', () => {
  it('addTombstone + isTombstoned + removeTombstone round-trip', () => {
    expect(dbMod.isTombstoned('project', 'P1')).toBe(false);
    dbMod.addTombstone('project', 'P1', { source: 'api', fsPaths: ['/x/y'] });
    expect(dbMod.isTombstoned('project', 'P1')).toBe(true);
    expect(dbMod.removeTombstone('project', 'P1')).toBe(true);
    expect(dbMod.isTombstoned('project', 'P1')).toBe(false);
  });

  it('listTombstones returns rows with parsed fs_paths', () => {
    dbMod.addTombstone('prompt', 'pr1', { fsPaths: ['/a', '/a.answer.json'] });
    const rows = dbMod.listTombstones();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resource_type: 'prompt',
      resource_id: 'pr1',
      fs_paths: ['/a', '/a.answer.json'],
    });
  });

  it('addTombstone twice on the same id is idempotent (REPLACE)', () => {
    dbMod.addTombstone('story', 's1');
    dbMod.addTombstone('story', 's1', { source: 'auto-cleanup' });
    expect(dbMod.listTombstones()).toHaveLength(1);
    expect(dbMod.listTombstones()[0].source).toBe('auto-cleanup');
  });
});

// ---------- sync layer respects tombstones -----------------------------------

describe('tombstones — sync.* skip + cleanup', () => {
  function writeStory(batchId, projectId, stories = []) {
    const dir = join(tmpDir, 'hu-stories', batchId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'batch.json'), JSON.stringify({
      id: batchId, session_id: batchId, project_id: projectId, stories,
    }));
  }
  function writePlan(projectSlug, planId) {
    const dir = join(tmpDir, '.kj', 'plans', projectSlug);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `plan-${planId}.json`);
    writeFileSync(file, JSON.stringify({
      version: 2, planId, projectDir: '/some/path', hus: [{ id: 'hu_1', title: 't' }],
    }));
    return file;
  }

  it('fullScan does NOT resurrect a tombstoned project', async () => {
    writeStory('batch-1', 'proj-A');
    dbMod.addTombstone('project', 'proj-A');
    syncMod.fullScan();
    expect(dbMod.getProjects().find((p) => p.id === 'proj-A')).toBeUndefined();
  });

  it('fullScan REMOVES the fs directory of a tombstoned story', () => {
    writeStory('batch-2', 'proj-B');
    const batchDir = join(tmpDir, 'hu-stories', 'batch-2');
    dbMod.addTombstone('story', 'batch-2');
    syncMod.fullScan();
    expect(existsSync(batchDir)).toBe(false);
  });

  it('fullScan ignores a tombstoned plan and deletes its file', () => {
    const planPath = writePlan('proj-slug', 'plan-xyz');
    dbMod.addTombstone('plan', 'plan-xyz');
    syncMod.fullScan();
    expect(existsSync(planPath)).toBe(false);
  });
});

// ---------- DELETE endpoints behaviour ---------------------------------------

describe('tombstones — DELETE endpoints', () => {
  it('DELETE /api/projects/:id tombstones project + its stories + sessions, removes fs paths', async () => {
    dbMod.upsertProject({ id: 'proj-X', name: 'X' });
    dbMod.upsertStory({ id: 'st-X-1', project_id: 'proj-X', status: 'pending' });
    dbMod.upsertSession({ id: 'sess-X-1', project_id: 'proj-X', status: 'running' });
    mkdirSync(join(tmpDir, 'hu-stories', 'st-X-1'), { recursive: true });
    mkdirSync(join(tmpDir, 'sessions', 'sess-X-1'), { recursive: true });

    const r = await request(app).delete('/api/projects/proj-X').expect(200);
    expect(r.body).toMatchObject({ deleted: true });
    expect(dbMod.isTombstoned('project', 'proj-X')).toBe(true);
    expect(dbMod.isTombstoned('story', 'st-X-1')).toBe(true);
    expect(dbMod.isTombstoned('session', 'sess-X-1')).toBe(true);
    expect(existsSync(join(tmpDir, 'hu-stories', 'st-X-1'))).toBe(false);
    expect(existsSync(join(tmpDir, 'sessions', 'sess-X-1'))).toBe(false);
  });

  it('DELETE /api/projects/:id returns 404 when the project does not exist', async () => {
    await request(app).delete('/api/projects/missing').expect(404);
    expect(dbMod.isTombstoned('project', 'missing')).toBe(false);
  });

  it('DELETE /api/prompts/:id removes fs files + tombstones', async () => {
    const promptsRoot = join(tmpDir, 'prompts');
    mkdirSync(promptsRoot, { recursive: true });
    writeFileSync(join(promptsRoot, 'pr-1.json'), JSON.stringify({ promptId: 'pr-1', question: 'q' }));
    writeFileSync(join(promptsRoot, 'pr-1.answer.json'), '{}');

    const r = await request(app).delete('/api/prompts/pr-1').expect(200);
    expect(r.body).toMatchObject({ deleted: true, filesRemoved: 2 });
    expect(dbMod.isTombstoned('prompt', 'pr-1')).toBe(true);
    expect(existsSync(join(promptsRoot, 'pr-1.json'))).toBe(false);
  });

  it('GET /api/prompts hides tombstoned prompts even if the .json file is still on disk', async () => {
    const promptsRoot = join(tmpDir, 'prompts');
    mkdirSync(promptsRoot, { recursive: true });
    writeFileSync(join(promptsRoot, 'pr-zombi.json'), JSON.stringify({ promptId: 'pr-zombi', question: 'q' }));
    dbMod.addTombstone('prompt', 'pr-zombi');

    const r = await request(app).get('/api/prompts').expect(200);
    expect(r.body.find((p) => p.promptId === 'pr-zombi')).toBeUndefined();
    // And the file was cleaned up as a side effect of the listing
    expect(readdirSync(promptsRoot).filter((n) => n === 'pr-zombi.json')).toHaveLength(0);
  });

  // ---------- PR B endpoints (story / session / plan / restore / list) ------

  it('DELETE /api/stories/:id tombstones + removes its batch dir', async () => {
    dbMod.upsertStory({ id: 'st-1', project_id: 'p1', status: 'pending' });
    const dir = join(tmpDir, 'hu-stories', 'st-1');
    mkdirSync(dir, { recursive: true });

    const r = await request(app).delete('/api/stories/st-1').expect(200);
    expect(r.body).toMatchObject({ deleted: true, dirRemoved: true });
    expect(dbMod.isTombstoned('story', 'st-1')).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('DELETE /api/sessions/:id tombstones + removes its session dir', async () => {
    dbMod.upsertSession({ id: 'sess-1', project_id: 'p1', status: 'running' });
    const dir = join(tmpDir, 'sessions', 'sess-1');
    mkdirSync(dir, { recursive: true });

    const r = await request(app).delete('/api/sessions/sess-1').expect(200);
    expect(r.body).toMatchObject({ deleted: true, dirRemoved: true });
    expect(dbMod.isTombstoned('session', 'sess-1')).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('DELETE /api/plans/:planId tombstones + removes the plan file (not the project)', async () => {
    const planDir = join(tmpDir, '.kj', 'plans', 'my-proj');
    mkdirSync(planDir, { recursive: true });
    const planFile = join(planDir, 'plan-xyz.json');
    writeFileSync(planFile, JSON.stringify({ version: 2, planId: 'xyz', hus: [] }));

    const r = await request(app).delete('/api/plans/xyz').expect(200);
    expect(r.body).toMatchObject({ deleted: true, fileRemoved: true });
    expect(dbMod.isTombstoned('plan', 'xyz')).toBe(true);
    expect(existsSync(planFile)).toBe(false);
  });

  it('GET /api/tombstones lists every active tombstone newest first', async () => {
    dbMod.addTombstone('project', 'old-proj', { source: 'api' });
    await new Promise((r) => setTimeout(r, 5));
    dbMod.addTombstone('prompt', 'recent-prompt', { source: 'api' });

    const r = await request(app).get('/api/tombstones').expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].resource_id).toBe('recent-prompt');
    expect(r.body[1].resource_id).toBe('old-proj');
  });

  it('POST /api/tombstones/:type/:id/restore removes the tombstone', async () => {
    dbMod.addTombstone('project', 'to-restore');
    expect(dbMod.isTombstoned('project', 'to-restore')).toBe(true);

    const r = await request(app).post('/api/tombstones/project/to-restore/restore').expect(200);
    expect(r.body).toMatchObject({ restored: true });
    expect(dbMod.isTombstoned('project', 'to-restore')).toBe(false);
  });

  it('POST /api/tombstones/.../restore returns 404 when tombstone does not exist', async () => {
    await request(app).post('/api/tombstones/project/never-buried/restore').expect(404);
  });
});
