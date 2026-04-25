import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { initDb, closeDb } from './db.js';
import { fullScan, startWatcher } from './sync.js';
import apiRoutes from './routes/api.js';
import pipelineRoutes from './routes/pipeline.js';
import { authMiddleware } from './auth.js';
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
 * Main entry point: initializes database, syncs data, and starts the server.
 */
async function main() {
  // Initialize SQLite
  console.log('[server] Initializing database...');
  initDb();

  // Full scan of existing files
  console.log('[server] Running full scan of JSON files...');
  fullScan();

  // Start file watcher
  const watcher = startWatcher();

  // Create Express app
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));
  app.use('/api', authMiddleware(), apiRoutes);
  app.use('/api/pipeline', authMiddleware(), pipelineRoutes);

  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });

  // Find available port
  const desiredPort = getDesiredPort();
  const port = await findAvailablePort(desiredPort);

  const server = app.listen(port, () => {
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
    console.log(`\n  Karajan HU Board`);
    console.log(`  -----------------`);
    console.log(`  PID:        ${process.pid}`);
    console.log(`  Running at: http://localhost:${port}`);
    console.log(`  Data dir:   ${process.env.KJ_HOME || '~/.karajan'}\n`);
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

main().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
