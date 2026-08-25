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
// Token configured but request comes from loopback (default supertest behaviour)
// -> auth is skipped (KJC-TSK-0355: only enforce on non-loopback).
// ---------------------------------------------------------------------------
describe('auth enabled, request from loopback', () => {
  const TOKEN = 'test-secret-42';

  it('allows requests without a token because peer is 127.0.0.1', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildApp();
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Token configured AND request comes from a non-loopback IP -> enforce auth.
// We synthesize a non-loopback peer by mounting a tiny middleware that
// rewrites req.ip / req.socket.remoteAddress before authMiddleware sees it.
// ---------------------------------------------------------------------------
describe('auth enabled, simulated non-loopback peer', () => {
  const TOKEN = 'test-secret-42';
  const FAKE_IP = '192.168.1.50';

  /** Build app with a middleware that fakes a non-loopback peer IP. */
  async function buildAppFromLan() {
    const { authMiddleware } = await import('../src/auth.js');
    const { default: apiRoutes } = await import('../src/routes/api.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Override req.ip with a configurable getter; auth.js consults
      // req.ip first and only falls back to req.socket.remoteAddress
      // when req.ip is empty, so we don't touch the socket (its
      // remoteAddress is a getter-only property and writing to it
      // throws).
      Object.defineProperty(req, 'ip', {
        configurable: true,
        get() { return FAKE_IP; },
      });
      next();
    });
    app.use('/api', authMiddleware(), apiRoutes);
    return app;
  }

  it('rejects requests with no auth header or query param', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.body.message).toMatch(/non-loopback/i);
  });

  it('accepts a valid Bearer token in Authorization header', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('accepts a valid token via ?token= query param', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app).get(`/api/dashboard?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('accepts a valid token via kj_board_token cookie', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Cookie', `kj_board_token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('rejects an invalid token', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  // The comparison is length-checked before timingSafeEqual, which throws on
  // a length mismatch. These are the shapes that would surface that.
  it('rejects a token that shares a prefix with the expected one', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${TOKEN.slice(0, -1)}X`);
    expect(res.status).toBe(401);
  });

  it('rejects a token shorter than the expected one', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${TOKEN.slice(0, 4)}`);
    expect(res.status).toBe(401);
  });

  it('rejects an empty Bearer token', async () => {
    process.env.HU_BOARD_TOKEN = TOKEN;
    const app = await buildAppFromLan();
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });
});
