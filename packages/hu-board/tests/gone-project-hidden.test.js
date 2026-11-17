// HU-4551 (#4394, ADR 0062): a project whose directory is gone is hidden from the
// board project list, not deleted: it is listed again when the directory comes back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let tmpDir;
let app;
let dbMod;
let projectDir;
let projectId;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-gone-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
  projectDir = join(tmpDir, 'se-va');
  mkdirSync(projectDir);
  mkdirSync(join(tmpDir, 'plans'));
  const planFile = join(tmpDir, 'plans', 'plan-gone.json');
  writeFileSync(planFile, JSON.stringify({
    version: 2, planId: 'plan-gone', task: 'x', projectDir, name: 'Se va',
    hus: [{ id: 'hu-01', status: 'pending', title: 'Una tarea' }], status: 'draft', createdAt: '2026-11-17T00:00:00Z',
  }));
  dbMod = await import('../src/db.js');
  dbMod.initDb();
  dbMod.upsertProject({ id: 'session-only', name: 'Session only' });
  const sync = await import('../src/sync.js');
  sync.syncPlanFile(planFile);
  projectId = sync.deriveProjectIdFromDir(projectDir);
  const { default: apiRoutes } = await import('../src/routes/api.js');
  app = express();
  app.use('/api', apiRoutes);
});

afterAll(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

const listed = async () => (await request(app).get('/api/projects')).body.map((p) => p.id);

describe('a project whose directory is gone (ADR 0062)', () => {
  it('is listed while its directory exists, and so is a project with no recorded directory', async () => {
    expect(await listed()).toEqual(expect.arrayContaining([projectId, 'session-only']));
  });

  it('is left out of the list once its directory is gone, but kept and reachable', async () => {
    rmSync(projectDir, { recursive: true, force: true });
    const ids = await listed();
    expect(ids).not.toContain(projectId);
    expect(ids).toContain('session-only');
    expect((await request(app).get(`/api/projects/${projectId}`)).status).toBe(200);
  });

  it('stays out of the list when a file takes the place of its directory', async () => {
    writeFileSync(projectDir, 'not a directory');
    expect(await listed()).not.toContain(projectId);
    rmSync(projectDir);
  });

  it('is listed again when its directory comes back', async () => {
    mkdirSync(projectDir);
    expect(await listed()).toContain(projectId);
  });
});
