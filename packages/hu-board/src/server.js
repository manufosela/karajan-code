import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { initDb, closeDb } from './db.js';
import { fullScan, startWatcher } from './sync.js';
import apiRoutes from './routes/api.js';
import pipelineRoutes from './routes/pipeline.js';
import ragRoutes from './routes/rag.js';
import wikiRoutes from './routes/wiki.js';
import governanceRoutes from './routes/governance.js';
import { authMiddleware } from './auth.js';
import { getOrCreateToken, getTokenPath } from './token-store.js';
import { createRequire } from 'node:module';
import { createTerminalManager } from './terminal.js';
import { terminalRouter, attachTerminalWs } from './terminal-wire.js';
import { reapZombieSessions } from './zombie-reaper.js';
import { reapZombieHus } from './hu-zombie-reaper.js';
import { setHuStatus as setHuStatusPlanMutation, setHuFailResult as setHuFailResultPlanMutation } from './plan-mutations.js';
import { cleanupEphemeralProjects } from './ephemeral-cleaner.js';
import { findAvailablePort as findAvailablePortBase } from 'karajan-core/port-check';

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
// KJC-TSK-0420: delegate to db.js::getKjHome so KARAJAN_HOME / KJ_HOME /
// VITEST all share one precedence chain.
import { getKjHome } from './db.js';
const PID_FILE = join(getKjHome(), 'hu-board.pid');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

/**
 * Cache-Control headers that tell the browser to revalidate every fetch.
 * Applied to HTML / JS / CSS so a server restart can't be hidden by stale
 * in-memory cache. Assets with content-hash in filename can override this
 * later with `immutable` if we adopt a build step.
 */
function noStoreHeaders(res, filePath) {
  if (/\.(html|js|css)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}

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
 * Build the rate-limit middleware for `/api`.
 *
 * Default is 600 req/min per IP (raised from 300 in KJC-BUG-0039 —
 * the first-load fanout of the dashboard + multiple tabs + SSE
 * reconnects after a refresh could push past 300/min and hit the user
 * with a 429 on the very first page they see).
 *
 * Override via env var `HU_BOARD_RATE_LIMIT=<n>` for unusual setups
 * (load tests, multi-board farms behind a shared NAT).
 *
 * SSE (`/api/events`) is exempt — a single persistent stream should
 * not count toward a per-minute request budget, and tab refreshes
 * legitimately create new SSE connections.
 *
 * @returns {import('express').RequestHandler}
 */
export function buildRateLimiter() {
  const raw = Number(process.env.HU_BOARD_RATE_LIMIT);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 600;
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',  // RateLimit-* headers
    legacyHeaders: false,         // drop X-RateLimit-*
    skip: (req) => req.path === '/events' || req.path.startsWith('/events/'),
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
  // Initialize SQLite. better-sqlite3 is a native module — when its
  // prebuilt binary is missing or ABI-mismatched (Node was upgraded),
  // initDb() throws. Surface an actionable message instead of a bare
  // stack trace so the user knows exactly what to run.
  console.log('[server] Initializing database...');
  try {
    initDb();
  } catch (err) {
    console.error('[server] FATAL: could not initialize the database.');
    console.error('[server] The native module better-sqlite3 failed to load, or the DB file could not be opened.');
    console.error('[server] Fix: run `npm rebuild better-sqlite3` (or reinstall karajan-code).');
    console.error('[server] Original error:', err?.stack || String(err));
    process.exit(1);
  }

  // Full scan of existing files BEFORE the reaper runs. Otherwise
  // fullScan would read every session.json from disk and overwrite
  // the reap-failed status the reaper just set, resurrecting the
  // zombie on every boot. Order matters here.
  console.log('[server] Running full scan of JSON files...');
  fullScan();

  // Reap any session that the orchestrator left in a non-terminal
  // state. Updates BOTH the DB row AND the session.json on disk so
  // the next boot's fullScan sees a stable `failed` status and never
  // resurrects the zombi.
  try {
    const dbHandle = (await import('./db.js')).getDb();
    const reaped = reapZombieSessions({ db: dbHandle });
    if (reaped.length > 0) {
      console.log(`[zombie-reaper] reaped ${reaped.length} stale session(s):`);
      for (const r of reaped) {
        const diskNote = r.disk_persisted ? '' : ' (disk write failed — DB-only)';
        console.log(`  - ${r.id} (was ${r.status_before}; ${r.reason})${diskNote}`);
      }
    } else {
      console.log('[zombie-reaper] no zombie sessions detected');
    }
  } catch (err) {
    // Never block startup on the reaper. Log and move on.
    console.warn(`[zombie-reaper] skipped: ${err.message}`);
  }

  // KJC-TSK-0394 step 3 — resetear a `pending` HUs colgadas en
  // coding/reviewing >30min (orquestador crashed mid-iteration). NO
  // a `failed` porque no sabemos el outcome; `result` se preserva.
  try {
    const dbHandle = (await import('./db.js')).getDb();
    const reapedHus = reapZombieHus({
      db: dbHandle,
      setHuStatus: setHuStatusPlanMutation,
      setHuFailResult: setHuFailResultPlanMutation,
    });
    if (reapedHus.length > 0) {
      console.log(`[hu-zombie-reaper] reset ${reapedHus.length} stuck HU(s) to pending:`);
      for (const r of reapedHus) {
        const planNote = r.plan_persisted ? '' : ' (plan write failed — DB-only)';
        console.log(`  - ${r.id} (was ${r.status_before}; ${r.reason})${planNote}`);
      }
    } else {
      console.log('[hu-zombie-reaper] no stuck HUs detected');
    }
  } catch (err) {
    console.warn(`[hu-zombie-reaper] skipped: ${err.message}`);
  }

  // KJC-TSK-0414 PR2 — reconciliación de sesiones hibernadas al arrancar.
  // Para cada session en ~/.kj/standby/<id>.json:
  //   - cooldownUntil <= now → spawn `kj resume <id>` inmediato
  //   - cooldownUntil > now  → re-programa setTimeout que dispara en cooldown
  // Idempotente (lockfile per session). Cero polling.
  try {
    const { reconcileAll } = await import('karajan-core/standby-scheduler');
    const { spawn } = await import('node:child_process');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const KJ_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'cli.js');
    const onResume = (sessionId) => {
      console.log(`[standby] reanudando sesión ${sessionId} (spawn kj standby resume)`);
      try {
        const child = spawn(process.execPath, [KJ_CLI, 'standby', 'resume', sessionId], {
          detached: true, stdio: 'ignore', env: process.env,
        });
        child.unref();
      } catch (err) {
        console.warn(`[standby] spawn resume falló para ${sessionId}: ${err.message}`);
      }
    };
    const r = reconcileAll({ onResume, logger: { info: console.log.bind(console), warn: console.warn.bind(console) } });
    if (r.total > 0) console.log(`[standby] reconcile: ${r.total} session(es) — ${r.immediate} resume inmediato, ${r.scheduled} programadas`);
  } catch (err) {
    console.warn(`[standby] reconcile skipped: ${err.message}`);
  }

  // KJC-TSK-0371 (board polish #3) — clean up ephemeral projects
  // (`/tmp/`-rooted, `tmp_*`/`test_*`/`demo_*`/`kj-test-*` prefixed)
  // that have been inactive for >24h. Runs AFTER the zombie-reaper
  // so any session that just got marked failed counts toward
  // last_activity correctly. The user can override per-project via
  // PATCH /api/projects/:id/is-test.
  try {
    const dbHandle = (await import('./db.js')).getDb();
    const cleaned = cleanupEphemeralProjects({ db: dbHandle });
    if (cleaned.length > 0) {
      console.log(`[ephemeral-cleaner] removed ${cleaned.length} ephemeral project(s):`);
      for (const c of cleaned) {
        console.log(`  - ${c.id} (${c.reason}; ${c.stories_deleted} stories, ${c.sessions_deleted} sessions cascaded)`);
      }
    } else {
      console.log('[ephemeral-cleaner] no ephemeral projects detected');
    }
  } catch (err) {
    console.warn(`[ephemeral-cleaner] skipped: ${err.message}`);
  }

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
  // node-pty es CJS nativo y @xterm se localiza por resolve: require clásico.
  const requireCjs = createRequire(import.meta.url);
  app.use(...buildSecurityMiddleware());
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR, { setHeaders: noStoreHeaders, etag: false, lastModified: false }));
  app.use('/api', buildRateLimiter(), authMiddleware(), apiRoutes);
  app.use('/api/pipeline', authMiddleware(), pipelineRoutes);
  app.use('/api/rag', authMiddleware(), ragRoutes);
  app.use('/api/wiki', authMiddleware(), wikiRoutes);
  app.use('/api/governance', authMiddleware(), governanceRoutes);

  // Terminal embebida (KJC-TSK-0816, ADR 0008): la lógica vive en
  // terminal.js; aquí solo el montaje. El agente arranca en el cwd del
  // daemon (kj go arranca el board desde el proyecto) u override por env.
  // xterm se sirve DESDE la dependencia — nada vendorizado al repo.
  const terminalManager = createTerminalManager({
    spawnPty: (...args) => requireCjs('node-pty').spawn(...args),
    cwd: process.env.HU_BOARD_TERMINAL_CWD || process.cwd(),
    promptArg: process.env.HU_BOARD_TERMINAL_PROMPT,
  });
  app.use(
    '/api/terminal',
    authMiddleware(),
    terminalRouter(terminalManager, { defaultAgent: process.env.HU_BOARD_TERMINAL_AGENT || 'claude' }),
  );
  app.use(
    '/vendor/xterm',
    express.static(dirname(requireCjs.resolve('@xterm/xterm/package.json'))),
  );

  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });

  // Find available port (always probed against loopback so the
  // result is meaningful regardless of bind host).
  const desiredPort = getDesiredPort();
  const port = await findAvailablePort(desiredPort);
  const bindHost = getBindHost();
  const isLoopback = LOOPBACK_ADDRESSES.has(bindHost);

  const server = app.listen(port, bindHost, () => {
    attachTerminalWs(server, terminalManager);
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
  //
  // Two pre-2026-05-07 footguns this fixes:
  //
  //   1) `server.close()` was called LAST, so for ~1s after `kj board
  //      stop` the HTTP server stayed up while watcher/DB cleanup ran.
  //      A browser refresh during that window — exactly the user's
  //      "1 segundo después se carga el board" report — saw a working
  //      board because the old keep-alive connections were still
  //      being served. Now we tell the server to stop accepting new
  //      connections IMMEDIATELY.
  //
  //   2) `server.close()` only waits for active connections to drain.
  //      The browser's HTTP/1.1 keep-alive connections can stay open
  //      for minutes, so the daemon process never actually exited
  //      after stop. `closeAllConnections()` (Node 18.2+) force-kills
  //      every active socket so the daemon can exit promptly.
  //
  //   3) A 5s hard deadline guarantees exit even if something goes
  //      wrong with the cleanup. SIGKILL-by-the-OS is the cure if
  //      the user really wants out, but a clean exit is the goal.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[server] Shutting down...');
    // 1. Stop accepting new connections + force-close existing ones.
    server.close(() => {
      // The cleanup happens in the close callback so we don't run it
      // before the server has detached from its listening socket.
      try { watcher.close(); } catch { /* ignore */ }
      try { closeDb(); } catch { /* ignore */ }
      try { rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
      console.log('[server] Shutdown complete.');
      process.exit(0);
    });
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    // 5s hard deadline: if the close callback hasn't fired by then,
    // something is wedged — exit anyway. unref so this timer doesn't
    // itself keep the loop alive.
    setTimeout(() => {
      console.warn('[server] Forced exit after 5s shutdown deadline.');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Whether this module runs as the board daemon. The legacy check
 * `import.meta.url === ` + "`file://${process.argv[1]}`" + ` silently
 * broke the daemon on Windows (backslashes), linked / global installs
 * (import.meta.url resolves symlinks, process.argv[1] does not) and
 * paths with spaces (percent-encoding): main() never ran, the process
 * exited 0 and nothing ever reached hu-board.log. The launcher now
 * sets KJ_BOARD_DAEMON=1, which we trust first; the normalised URL
 * comparison (symlinks resolved on both sides) is the fallback.
 * Exported so tests can exercise it without spawning a process.
 * @returns {boolean}
 */
export function isDaemonEntryPoint() {
  if (process.env.KJ_BOARD_DAEMON === '1') return true;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

// Only run main() when this file is the entry point. Tests import
// the helpers above without spinning up the server.
if (isDaemonEntryPoint()) {
  // A dying daemon must never die in silence: the launcher wires
  // stderr to hu-board.log, so log the cause before exiting non-zero.
  process.on('uncaughtException', (err) => {
    console.error('[server] FATAL uncaught exception:', err?.stack || String(err));
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] FATAL unhandled rejection:', reason?.stack || String(reason));
    process.exit(1);
  });
  main().catch((err) => {
    console.error('[server] Fatal error:', err?.stack || err);
    process.exit(1);
  });
}
