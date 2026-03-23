import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { initDb, closeDb } from './db.js';
import { fullScan, startWatcher } from './sync.js';
import apiRoutes from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

/**
 * Checks if a port is available.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Finds an available port starting from the given port.
 * @param {number} startPort
 * @param {number} maxAttempts
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort, maxAttempts = 11) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) return port;
    console.log(`[server] Port ${port} is busy, trying ${port + 1}...`);
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts - 1}`);
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
  app.use('/api', apiRoutes);

  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });

  // Find available port
  const desiredPort = getDesiredPort();
  const port = await findAvailablePort(desiredPort);

  const server = app.listen(port, () => {
    console.log(`\n  Karajan HU Board`);
    console.log(`  -----------------`);
    console.log(`  Running at: http://localhost:${port}`);
    console.log(`  Data dir:   ${process.env.KJ_HOME || '~/.karajan'}\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[server] Shutting down...');
    watcher.close();
    closeDb();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
