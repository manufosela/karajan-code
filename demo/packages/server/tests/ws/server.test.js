import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createTestDb, createTestApp, seedUser } from '../helpers.js';
import { createWsServer } from '../../src/ws/server.js';
import { signAccessToken } from '../../src/auth/jwt.js';

describe('WebSocket server', () => {
  let db, server, wss;

  afterEach(async () => {
    if (wss) wss.close();
    if (server) await new Promise((r) => server.close(r));
    if (db) db.close();
  });

  async function setup() {
    db = createTestDb();
    const app = createTestApp(db);
    server = createServer(app);
    wss = createWsServer(server, db);
    await new Promise((r) => server.listen(0, r));
    return server.address().port;
  }

  it('rejects unauthenticated connections', async () => {
    const port = await setup();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    await new Promise((resolve) => {
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
    });
  });

  it('accepts authenticated connections via query param', async () => {
    const port = await setup();
    const seeded = await seedUser(db);
    const token = signAccessToken({ id: seeded.user.id, email: seeded.user.email });
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);

    await new Promise((resolve) => {
      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      });
    });
  });
});
