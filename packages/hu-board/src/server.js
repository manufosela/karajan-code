import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { initDb, closeDb } from './db.js';
import { fullScan, startWatcher } from './sync.js';
import apiRoutes from './routes/api.js';
import pipelineRoutes from './routes/pipeline.js';
import { authMiddleware } from './auth.js';
import { getOrCreateToken, getTokenPath } from './token-store.js';
import { reapZombieSessions } from './zombie-reaper.js';
import { findAvailablePort as findAvailablePortBase } from '../../../src/utils/port-check.js';

/**
 * Path to the PID file the CLI's `kj board start` / `kj board stop`
 * also use. Pre-v2.7.5 this was written ONLY by the CLI launcher,
 * so a self-respawn (the 🔁 button on the board) left a stale PID
 * pointing at a dead process — and the next `kj plan` saw that, gave
 * up on the existing board, and spawned a new one on port 4001.
 *
 * Now the server writes its own PID on every start so both the CLI
 * launch and the in-place restart keep the file accurate.
 */
const PID_FILE = join(process.env.KJ_HOME || join(homedir(), '.karajan'), 'hu-board.pid');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

/** Default bind: loopback only. Override with BIND_HOST=0.0.0.0 (or any IP). */
const DEFAULT_BIND_HOST = '127.0.0.1';

/** Loopback addresses that don't need a security warning at startup. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Finds an available port starting from the given port, logging each busy
 * hop. Delegates to the shared util in src/utils/port-check.js.
 * @param {number} startPort
 * @param {number} maxAttempts
 * @returns {Promise<number>}
 */
function findAvailablePort(startPort, maxAttempts = 11) {
  return findAvailablePortBase(startPort, maxAttempts, (port) => {
    console.log(`[server] Port ${port} is busy, trying ${port + 1}...`);
  });
}

/**
 * Parses the desired port from env var or --port flag.
 * @returns {number}
 */
function getDesiredPort() {
  const portArg = process.argv.find((arg, i, arr) => arr[i - 1] === '--port');
  if (portArg) return parseInt(portArg, 10);
  return parseInt(process.env.PORT || '4000', 10);
}

/**
 * Resolve the bind host. Precedence:
 *   1. `BIND_HOST` env var (set by `kj board start --bind <host>`)
 *   2. Default: 127.0.0.1 (loopback only)
 * @returns {string}
 */
function getBindHost() {
  return process.env.BIND_HOST || DEFAULT_BIND_HOST;
}

/**
 * Build the security middleware stack used before any route handler.
 * Exposed as a function so tests can mount the same stack on a
 * disposable Express app.
 * @returns {import('express').RequestHandler[]}
 */
export function buildSecurityMiddleware() {
  const stack = [
    // Default helmet config sets X-Content-Type-Options, X-DNS-Prefetch-Control,
    // X-Frame-Options, Strict-Transport-Security (when over HTTPS), and a
    // conservative Content-Security-Policy. We keep CSP loose enough for the
    // existing inline scripts in public/index.html to run.
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Allow inline scripts, styles AND inline event handlers
          // (onclick="..."). Helmet's default puts `script-src-attr
          // 'none'` which silently blocks every onclick in app.js —
          // detected during the 2026-05-07 dogfooding session when
          // `kj board` Sessions cards became un-clickable.
          //
          // Tightening this is a follow-up: app.js would need to
          // migrate every inline handler to addEventListener.
          "script-src": ["'self'", "'unsafe-inline'"],
          "script-src-attr": ["'unsafe-inline'"],
          // Google Fonts (CSS + woff2) used by index.html.
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:"],
        },
      },
      // The board is a same-origin SPA; cross-origin embedders should
      // never load it, but COEP/CORP defaults sometimes break dev tools
      // proxies. Keep them off until there's a concrete need.
      crossOriginEmbedderPolicy: false,
    }),
  ];
  return stack;
}

/**
 * Build the rate-limit middleware for `/api`. Default is 300 req/min
 * per IP — comfortable for the dashboard's polling pattern (typical:
 * a /api/sync + a /api/dashboard every 2-3s) and well below what an
 * abusive scanner would do.
 * @returns {import('express').RequestHandler}
 */
export function buildRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',  // RateLimit-* headers
    legacyHeaders: false,         // drop X-RateLimit-*
    message: {
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Try again in a few seconds.',
    },
  });
}

/**
 * Main entry point: initializes database, syncs data, and starts the server.
 */
async function main() {
  // Initialize SQLite
  console.log('[server] Initializing database...');
  initDb();

  // Reap any session that the orchestrator left in a non-terminal
  // state. The board used to surface 8-day-old `Karajan needs an
  // answer` modals on startup because nothing ever flipped those
  // sessions to `failed`. See packages/hu-board/src/zombie-reaper.js
  // for the threshold rationale.
  try {
    const dbHandle = (await import('./db.js')).getDb();
    const reaped = reapZombieSessions({ db: dbHandle });
    if (reaped.length > 0) {
      console.log(`[zombie-reaper] reaped ${reaped.length} stale session(s):`);
      for (const r of reaped) {
        console.log(`  - ${r.id} (was ${r.status_before}; ${r.reason})`);
      }
    }
  } catch (err) {
    // Never block startup on the reaper. Log and move on.
    console.warn(`[zombie-reaper] skipped: ${err.message}`);
  }

  // Full scan of existing files
  console.log('[server] Running full scan of JSON files...');
  fullScan();

  // Start file watcher
  const watcher = startWatcher();

  // Bootstrap the auth token before mounting routes. The token is
  // only ENFORCED for non-loopback peers (see auth.js), but we set
  // it unconditionally so flipping `--bind 0.0.0.0` later doesn't
  // require a manual file fiddle.
  if (!process.env.HU_BOARD_TOKEN) {
    const token = getOrCreateToken();
    if (token) process.env.HU_BOARD_TOKEN = token;
  }

  // Create Express app
  const app = express();
  app.use(...buildSecurityMiddleware());
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));
  app.use('/api', buildRateLimiter(), authMiddleware(), apiRoutes);
  app.use('/api/pipeline', authMiddleware(), pipelineRoutes);

  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });

  // Find available port (always probed against loopback so the
  // result is meaningful regardless of bind host).
  const desiredPort = getDesiredPort();
  const port = await findAvailablePort(desiredPort);
  const bindHost = getBindHost();
  const isLoopback = LOOPBACK_ADDRESSES.has(bindHost);

  const server = app.listen(port, bindHost, () => {
    // Write the PID file so the CLI's `kj board status / stop` and
    // the next `kj plan`'s startBoard() check find this server. The
    // file used to be written only by `kj board start`'s launcher,
    // which meant the 🔁 self-respawn left a stale PID and the next
    // auto-start spawned a duplicate board on the next free port.
    try {
      mkdirSync(dirname(PID_FILE), { recursive: true });
      writeFileSync(PID_FILE, String(process.pid), 'utf8');
    } catch (err) {
      console.warn(`[server] could not write PID file: ${err.message}`);
    }
    const visibleHost = isLoopback ? 'localhost' : bindHost;
    console.log(`\n  Karajan HU Board`);
    console.log(`  -----------------`);
    console.log(`  PID:        ${process.pid}`);
    console.log(`  Running at: http://${visibleHost}:${port}`);
    console.log(`  Data dir:   ${process.env.KJ_HOME || '~/.karajan'}`);
    if (!isLoopback) {
      const token = process.env.HU_BOARD_TOKEN;
      console.log('');
      console.log('  ⚠️  Bound to non-loopback interface.');
      console.log(`     Token required for non-loopback peers: ${getTokenPath()}`);
      if (token) {
        console.log(`     URL with token: http://${bindHost}:${port}/?token=${token}`);
      }
    }
    console.log('');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[server] Shutting down...');
    watcher.close();
    closeDb();
    // Best-effort PID file cleanup on graceful exit. If we crash the
    // file stays — the CLI's `isProcessAlive` check handles that.
    try { rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main() when this file is the entry point. Tests import
// the helpers above without spinning up the server.
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main().catch((err) => {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  });
}
