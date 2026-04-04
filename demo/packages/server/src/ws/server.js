import { WebSocketServer } from 'ws';
import { parse as parseUrl } from 'node:url';
import { parse as parseCookie } from 'cookie';
import { verifyToken } from '../auth/jwt.js';
import { wsMessageSchema } from '@taskboard/shared';
import { BroadcastManager } from './broadcast.js';
import { handleMessage } from './handlers.js';
import { logger } from '../logger.js';

/**
 * Attach WebSocket server to an HTTP server.
 * @param {import('http').Server} server
 * @param {import('better-sqlite3').Database} db
 * @returns {WebSocketServer}
 */
export function createWsServer(server, db) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = new BroadcastManager();

  wss.on('connection', (ws, req) => {
    const userId = authenticateWs(req);

    if (!userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info({ userId }, 'WS client connected');

    ws.on('message', (raw) => {
      const parsed = parseWsMessage(raw);
      if (!parsed) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid message format' } }));
        return;
      }
      handleMessage({ db, broadcast, ws, userId, message: parsed });
    });

    ws.on('close', () => {
      broadcast.leaveAll(ws);
      logger.info({ userId }, 'WS client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err, userId }, 'WS error');
    });
  });

  return wss;
}

/**
 * Authenticate a WebSocket upgrade request.
 * Tries cookie first, then query param fallback.
 * @param {import('http').IncomingMessage} req
 * @returns {string | null} userId or null
 */
function authenticateWs(req) {
  try {
    // Try cookie
    const cookies = parseCookie(req.headers.cookie || '');
    let token = cookies.access_token;

    // Fallback: query param
    if (!token) {
      const query = parseUrl(req.url, true).query;
      token = /** @type {string} */ (query.token);
    }

    if (!token) return null;

    const decoded = verifyToken(token);
    return decoded.sub;
  } catch {
    return null;
  }
}

/**
 * Parse and validate a raw WebSocket message.
 * @param {import('ws').RawData} raw
 * @returns {{ type: string, payload?: Record<string, unknown> } | null}
 */
function parseWsMessage(raw) {
  try {
    const data = JSON.parse(raw.toString());
    const result = wsMessageSchema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
