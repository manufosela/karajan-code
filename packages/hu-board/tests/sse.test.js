import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import http from 'node:http';

// Integration test for GET /api/events. We exercise the endpoint with
// a raw HTTP client instead of supertest because supertest buffers
// the response until it ends, and SSE streams don't end — we need to
// read chunks as they arrive.

let tmpDir;
let server;
let port;
let dbMod;
let busMod;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-sse-'));
  process.env.KJ_HOME = tmpDir;

  dbMod = await import('../src/db.js');
  dbMod.initDb();
  busMod = await import('../src/event-bus.js');
  busMod._resetForTests();

  const { default: apiRoutes } = await import('../src/routes/api.js');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

/**
 * Open a raw HTTP request to /api/events and resolve once we've
 * collected `want` full SSE messages (each "\n\n"-terminated). Kills
 * the socket after, so the server's close handler fires.
 */
function collectSseMessages(want, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port, path: '/api/events' }, (res) => {
      let buf = '';
      const frames = [];
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`timed out after ${frames.length}/${want} frames`));
      }, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          frames.push(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
          if (frames.length >= want) {
            clearTimeout(timer);
            req.destroy();
            resolve(frames);
            return;
          }
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

describe('GET /api/events', () => {
  it('sends a hello frame immediately on connect', async () => {
    const [hello] = await collectSseMessages(1);
    expect(hello).toContain('event: hello');
    expect(hello).toContain('data: {"ok":true}');
  });

  it('streams a published bus event to the connected client', async () => {
    // Kick the bus on the next tick so the client is already subscribed.
    setTimeout(() => busMod.publish({ type: 'plan', planId: 'p1', projectId: 'proj' }), 50);
    const frames = await collectSseMessages(2);
    const dataFrame = frames.find((f) => f.startsWith('data:'));
    expect(dataFrame).toBeDefined();
    const payload = JSON.parse(dataFrame.replace(/^data:\s*/, ''));
    expect(payload).toEqual({ type: 'plan', planId: 'p1', projectId: 'proj' });
  });

  it('unsubscribes on connection close', async () => {
    expect(busMod.subscriberCount()).toBe(0);
    const frames = await collectSseMessages(1);
    expect(frames[0]).toContain('hello');
    // The socket was destroyed inside collectSseMessages; the server's
    // `req.on('close', …)` fires on the next macrotask. Poll up to
    // 500ms (10 × 50ms) so we don't race the close handler on slow
    // CI runners.
    for (let i = 0; i < 10 && busMod.subscriberCount() !== 0; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(busMod.subscriberCount()).toBe(0);
  });
});
