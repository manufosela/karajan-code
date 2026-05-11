/**
 * KJC-TSK-0355 — verifies the security middleware stack (helmet +
 * rate-limit) wired into server.js. Tests use a disposable Express
 * app so we don't have to spin up the real DB-backed server.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildSecurityMiddleware, buildRateLimiter } from '../src/server.js';

function buildApp({ withRateLimit = false } = {}) {
  const app = express();
  app.use(...buildSecurityMiddleware());
  if (withRateLimit) app.use('/api', buildRateLimiter());
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('security middleware — helmet headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(buildApp()).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to deny clickjacking', async () => {
    const res = await request(buildApp()).get('/api/ping');
    // helmet defaults to SAMEORIGIN; the important thing is that it's
    // NOT absent (clickjacking surface) and NOT a wildcard.
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-frame-options']).toMatch(/^(DENY|SAMEORIGIN)$/i);
  });

  it('sets a Content-Security-Policy header', async () => {
    const res = await request(buildApp()).get('/api/ping');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toMatch(/default-src/);
  });

  // Regression pin for the 2026-05-07 dogfooding bug: the original
  // helmet config (PR #607) put `script-src-attr 'none'` by default,
  // silently blocking every `onclick="..."` in app.js. Sessions cards
  // became un-clickable. Without this directive, inline event handlers
  // do not run.
  it('allows inline event handlers (script-src-attr unsafe-inline)', async () => {
    const res = await request(buildApp()).get('/api/ping');
    const csp = res.headers['content-security-policy'] || '';
    // script-src-attr must EXIST and must allow 'unsafe-inline'.
    expect(csp).toMatch(/script-src-attr[^;]*'unsafe-inline'/);
  });

  // Google Fonts loaded from index.html — must be allowed by both
  // style-src (the @import of CSS) and font-src (the woff2 files).
  it('allows Google Fonts CSS (style-src) and font files (font-src)', async () => {
    const res = await request(buildApp()).get('/api/ping');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toMatch(/style-src[^;]*fonts\.googleapis\.com/);
    expect(csp).toMatch(/font-src[^;]*fonts\.gstatic\.com/);
  });

  it('removes the X-Powered-By: Express header', async () => {
    const res = await request(buildApp()).get('/api/ping');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('security middleware — rate limit', () => {
  it('emits standard RateLimit headers and lets normal traffic through', async () => {
    const app = buildApp({ withRateLimit: true });
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    // express-rate-limit "draft-7" emits RateLimit / RateLimit-Remaining etc.
    const headerNames = Object.keys(res.headers);
    expect(headerNames.some((h) => /^ratelimit/i.test(h))).toBe(true);
  });

  it('returns 429 once the per-window quota is exhausted', async () => {
    // Build an app with a deliberately tiny limit so the test stays fast.
    const app = express();
    app.use(...buildSecurityMiddleware());
    const limiter = (await import('express-rate-limit')).default({
      windowMs: 60 * 1000,
      limit: 3,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too Many Requests' },
    });
    app.use('/api', limiter);
    app.get('/api/ping', (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    for (let i = 0; i < 3; i++) {
      const r = await agent.get('/api/ping');
      expect(r.status).toBe(200);
    }
    const blocked = await agent.get('/api/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Too Many Requests');
  });

  // KJC-BUG-0039: SSE must be exempt from the rate limit. A single
  // persistent stream + tab refreshes were enough to hit the old 300/min
  // budget on the very first page load.
  it('exempts /api/events (SSE) from the rate limit', async () => {
    const original = process.env.HU_BOARD_RATE_LIMIT;
    process.env.HU_BOARD_RATE_LIMIT = '3';
    try {
      const app = express();
      app.use(...buildSecurityMiddleware());
      app.use('/api', buildRateLimiter());
      app.get('/api/events', (_req, res) => res.json({ stream: true }));
      app.get('/api/ping', (_req, res) => res.json({ ok: true }));
      const agent = request(app);
      // Exhaust ping quota
      for (let i = 0; i < 3; i++) await agent.get('/api/ping');
      const pingBlocked = await agent.get('/api/ping');
      expect(pingBlocked.status).toBe(429);
      // SSE must still pass even when quota is exhausted
      const sse = await agent.get('/api/events');
      expect(sse.status).toBe(200);
    } finally {
      if (original === undefined) delete process.env.HU_BOARD_RATE_LIMIT;
      else process.env.HU_BOARD_RATE_LIMIT = original;
    }
  });

  it('honors HU_BOARD_RATE_LIMIT env var override', async () => {
    const original = process.env.HU_BOARD_RATE_LIMIT;
    process.env.HU_BOARD_RATE_LIMIT = '2';
    try {
      const app = express();
      app.use(...buildSecurityMiddleware());
      app.use('/api', buildRateLimiter());
      app.get('/api/ping', (_req, res) => res.json({ ok: true }));
      const agent = request(app);
      expect((await agent.get('/api/ping')).status).toBe(200);
      expect((await agent.get('/api/ping')).status).toBe(200);
      expect((await agent.get('/api/ping')).status).toBe(429);
    } finally {
      if (original === undefined) delete process.env.HU_BOARD_RATE_LIMIT;
      else process.env.HU_BOARD_RATE_LIMIT = original;
    }
  });
});
