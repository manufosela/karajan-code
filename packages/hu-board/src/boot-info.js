/**
 * Process-scoped boot info (KJC-TSK-0379).
 *
 * BOOT_TIME is captured at module load and exposed via /api/version so
 * the client can detect server restarts and trigger a reload. Lives in
 * its own module to avoid the server.js ↔ routes/api.js import cycle.
 */

import { createRequire } from 'node:module';

export const BOOT_TIME = new Date().toISOString();

const require = createRequire(import.meta.url);
export const PKG_VERSION = (() => {
  try { return require('../package.json').version; } catch { return 'unknown'; }
})();
