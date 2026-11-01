import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// KJC-TSK-0541: the system routes no other suite reaches through HTTP (shutdown, sync),
// so moving them out of routes/api.js stays guarded.
let tmpDir;
let app;
let dbMod;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-system-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
  process.env.KJ_BOARD_RESTART_MODE = 'echo';
  dbMod = await import('../src/db.js');
  dbMod.initDb();
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
  delete process.env.KJ_BOARD_RESTART_MODE;
});

describe('system routes', () => {
  it('POST /board/shutdown acks without exiting in echo mode', async () => {
    const res = await request(app).post('/api/board/shutdown');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: 'echo' });
  });

  it('POST /sync rescans and reports the project count', async () => {
    const res = await request(app).post('/api/sync');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(true);
    expect(res.body.projects).toBe(dbMod.getProjects().length);
  });
});
