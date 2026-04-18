/**
 * TCP port availability helpers.
 *
 * Originally lived in packages/hu-board/src/server.js. Moved here so the
 * doctor/preflight subsystem (src/checks/) and hu-board share a single
 * implementation.
 */

import { createServer } from "node:net";

/**
 * Check whether a TCP port is available to bind on localhost.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Find the first available port starting from `startPort`.
 *
 * @param {number} startPort       - first port to try
 * @param {number} [maxAttempts=11] - how many consecutive ports to probe
 * @param {(port: number) => void} [onBusy] - called for each busy port seen
 * @returns {Promise<number>}      - resolves with the first free port found
 * @throws {Error} if no port is free within the range
 */
export async function findAvailablePort(startPort, maxAttempts = 11, onBusy) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) return port;
    if (onBusy) onBusy(port);
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts - 1}`);
}
