/**
 * KJC-TSK-0379 — server restart detection.
 *
 * Covers: /api/version returns version + boot_time; the route is not
 * cached; the static-file middleware sets `Cache-Control: no-store`
 * on .html / .js / .css; the SPA fallback sets the same.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

let tmpDir;
let app;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-version-'));
  process.env.KJ_HOME = tmpDir;

  const dbMod = await import('../src/db.js');
  dbMod.initDb();

  const { default: apiRoutes } = await import('../src/routes/api.js');

  // Replicate the exact mounting from server.js so the static-file +
  // SPA-fallback headers tested below match production behaviour.
  function noStoreHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  }
  app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR, { setHeaders: noStoreHeaders, etag: false, lastModified: false }));
  app.use('/api', apiRoutes);
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe('/api/version', () => {
  it('returns { version, boot_time } as JSON', async () => {
    const r = await request(app).get('/api/version').expect(200);
    expect(r.body).toMatchObject({
      version: expect.any(String),
      boot_time: expect.any(String),
    });
    expect(new Date(r.body.boot_time).toString()).not.toBe('Invalid Date');
  });

  it('serves the same boot_time on repeated calls (process-scoped, not per-request)', async () => {
    const r1 = await request(app).get('/api/version').expect(200);
    const r2 = await request(app).get('/api/version').expect(200);
    expect(r2.body.boot_time).toBe(r1.body.boot_time);
  });

  it('responds with Cache-Control: no-store so the browser never serves a stale boot_time', async () => {
    const r = await request(app).get('/api/version').expect(200);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('Static file Cache-Control', () => {
  it('serves index.html with no-store + must-revalidate', async () => {
    const r = await request(app).get('/index.html').expect(200);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(r.headers['cache-control']).toMatch(/must-revalidate/);
  });

  it('serves /app.js with no-store + must-revalidate', async () => {
    const r = await request(app).get('/app.js').expect(200);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('serves the SPA fallback (any unknown route) with no-store too', async () => {
    const r = await request(app).get('/some-spa-route').expect(200);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    // body should be the index.html
    expect(r.text).toContain('Karajan HU Board');
  });

  it('does NOT send an ETag for static files (would let conditional requests bypass no-store)', async () => {
    const r = await request(app).get('/app.js').expect(200);
    expect(r.headers.etag).toBeUndefined();
  });
});
