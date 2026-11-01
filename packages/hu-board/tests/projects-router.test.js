import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// KJC-TSK-0541: the project routes no other suite reaches through HTTP (rename, preflight),
// so moving them out of routes/api.js stays guarded.
let tmpDir;
let app;
let dbMod;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-projects-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
  dbMod = await import('../src/db.js');
  dbMod.initDb();
  dbMod.upsertProject({ id: 'proj-r', name: 'Old name' });
  const { default: apiRoutes } = await import('../src/routes/api.js');
  app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
});

afterAll(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

describe('project routes', () => {
  it('PUT /projects/:id/name renames the project', async () => {
    const res = await request(app).put('/api/projects/proj-r/name').send({ name: 'New name' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, name: 'New name' });
    const detail = await request(app).get('/api/projects/proj-r');
    expect(detail.body.name).toBe('New name');
  });

  it('PUT /projects/:id/name answers 404 for an unknown project and 400 for an empty name', async () => {
    expect((await request(app).put('/api/projects/nope/name').send({ name: 'X' })).status).toBe(404);
    expect((await request(app).put('/api/projects/proj-r/name').send({ name: '  ' })).status).toBe(400);
  });

  it('GET /projects/:id/preflight answers the checks even without plans on disk', async () => {
    const res = await request(app).get('/api/projects/proj-r/preflight');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
  });
});
