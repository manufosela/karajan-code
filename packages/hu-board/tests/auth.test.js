import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let tmpDir;
let dbMod;

/** Build a fresh Express app with auth middleware + API routes. */
async function buildApp() {
  // Force re-import so the middleware picks up current env
  const { authMiddleware } = await import('../src/auth.js');
  const { default: apiRoutes } = await import('../src/routes/api.js');

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware(), apiRoutes);
  return app;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-auth-'));
  process.env.KJ_HOME = tmpDir;

  dbMod = await import('../src/db.js');
  dbMod.initDb();

  // Seed minimal data so GET /api/dashboard returns 200
  dbMod.upsertProject({ id: 'proj-1', name: 'P1' });
});

afterAll(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

afterEach(() => {
  delete process.env.HU_BOARD_TOKEN;
});

// ---------------------------------------------------------------------------
// No token configured -> backward compatible, all requests pass
// ---------------------------------------------------------------------------
describe('auth disabled (no HU_BOARD_TOKEN)', () => {
  it('allows requests without any credentials', async () => {
    delete process.env.HU_BOARD_TOKEN;
    const app = await buildApp();
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Token configured -> enforce auth
// ---------------------------------------------------------------------------
describe('auth enabled (HU_BOARD_TOKEN set)', () => {
  const TOKEN = 'test-secret-42';

  it('rejects requests with no auth header or query param', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildApp();
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.body.message).toContain('HU_BOARD_TOKEN');
  });

  it('accepts a valid Bearer token in Authorization header', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildApp();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('accepts a valid token via ?token= query param', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildApp();
    const res = await request(app).get(`/api/dashboard?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('rejects an invalid token', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildApp();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});
