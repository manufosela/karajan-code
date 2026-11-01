/**
 * KJC-BUG-0463 — an /api route that does not exist answers 404 JSON. The SPA
 * fallback used to catch every GET, so a retired or mistyped API route got the
 * app's index.html with a 200 and the caller failed parsing it as JSON.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiNotFound } from '../src/server.js';

function buildApp() {
  const app = express();
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiNotFound);
  app.get('/{*splat}', (_req, res) => res.type('html').send('<!doctype html><title>board</title>'));
  return app;
}

describe('apiNotFound', () => {
  it('answers an unknown /api route with 404 JSON naming it, for any method', async () => {
    for (const [method, path] of [['get', '/api/standby'], ['post', '/api/runs/p1/stop'], ['delete', '/api/nope/1']]) {
      const res = await request(buildApp())[method](path);
      expect(res.status, path).toBe(404);
      expect(res.type).toBe('application/json');
      expect(res.body.error).toBe(`no such API route: ${method.toUpperCase()} ${path}`);
    }
  });

  it('leaves the known API routes and the app pages alone', async () => {
    expect((await request(buildApp()).get('/api/ping')).body).toEqual({ ok: true });
    const page = await request(buildApp()).get('/board/x');
    expect(page.status).toBe(200);
    expect(page.type).toBe('text/html');
  });
});
