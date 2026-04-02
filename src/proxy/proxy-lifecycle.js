import net from "node:net";
import http from "node:http";
import { createProxyServer } from "./proxy-server.js";

/** @type {import('./proxy-server.js').ProxyServer | null} */
let proxyInstance = null;
let proxyPort = 0;
let orphanCheckInterval = null;

const DEFAULT_TARGET_HOSTS = {
  "api.anthropic.com": "anthropic",
  "api.openai.com": "openai",
  "generativelanguage.googleapis.com": "gemini",
};

/**
 * Find a free port on localhost by briefly binding a server to port 0.
 * @returns {Promise<number>}
 */
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Wait until the proxy health endpoint responds with 200.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForHealth(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) {
        return reject(new Error("Proxy health check timed out"));
      }
      const req = http.get(`http://127.0.0.1:${port}/_kj/health`, (res) => {
        if (res.statusCode === 200) {
          // Consume response body to free socket
          res.resume();
          resolve();
        } else {
          res.resume();
          setTimeout(attempt, 50);
        }
      });
      req.on("error", () => setTimeout(attempt, 50));
    }
    attempt();
  });
}

/**
 * Start orphan prevention: periodically check if the parent process is still alive.
 * If the parent exits, stop the proxy to avoid orphan servers.
 */
function startOrphanPrevention() {
  const parentPid = process.ppid;
  orphanCheckInterval = setInterval(() => {
    try {
      // process.kill(pid, 0) throws if process doesn't exist
      process.kill(parentPid, 0);
    } catch {
      // Parent is gone — self-terminate
      stopProxy().catch(() => {});
      clearInterval(orphanCheckInterval);
      orphanCheckInterval = null;
    }
  }, 5000);

  // Don't keep the event loop alive just for orphan checks
  if (orphanCheckInterval.unref) {
    orphanCheckInterval.unref();
  }
}

/**
 * Start the proxy server in-process.
 *
 * @param {object} options
 * @param {object} [options.config] - Optional config overrides
 * @param {Record<string, string>} [options.config.targetHosts] - Host-to-provider map
 * @param {string} [options.sessionId] - Session identifier (for logging)
 * @returns {Promise<{port: number, baseUrls: {anthropic: string, openai: string, gemini: string}}>}
 */
export async function startProxy({ config = {}, sessionId } = {}) {
  if (proxyInstance) {
    // Already running — return current info
    return buildResult(proxyPort);
  }

  const port = await findFreePort();
  const targetHosts = config.targetHosts || DEFAULT_TARGET_HOSTS;

  proxyInstance = createProxyServer({ port, targetHosts });
  await proxyInstance.listen();
  proxyPort = proxyInstance.port;

  await waitForHealth(proxyPort);
  startOrphanPrevention();

  return buildResult(proxyPort);
}

/**
 * Graceful shutdown with 5s timeout, then force cleanup.
 * @returns {Promise<void>}
 */
export async function stopProxy() {
  if (orphanCheckInterval) {
    clearInterval(orphanCheckInterval);
    orphanCheckInterval = null;
  }

  if (!proxyInstance) return;

  const instance = proxyInstance;
  proxyInstance = null;
  proxyPort = 0;

  // Race: graceful close vs 5s timeout
  const graceful = instance.close();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    if (timer.unref) timer.unref();
  });

  await Promise.race([graceful, timeout]);
}

/**
 * Returns env vars to inject into agent subprocesses so they route through the proxy.
 * @returns {Record<string, string> | null} env vars, or null if proxy is not running
 */
export function getProxyEnv() {
  if (!proxyInstance || !proxyPort) return null;

  const base = `http://127.0.0.1:${proxyPort}`;
  return {
    // SDK-specific base URL vars — used by SDKs that respect them.
    // Claude Code CLI does NOT respect ANTHROPIC_BASE_URL, so claude-agent
    // must skip proxy injection until upstream support is confirmed.
    ANTHROPIC_BASE_URL: base,
    OPENAI_BASE_URL: base,
    GEMINI_API_BASE: base,
  };
}

/**
 * Return proxy stats if running, or null otherwise.
 * @returns {{ port: number, requests: number, bytes_in: number, bytes_out: number } | null}
 */
export function getProxyStats() {
  if (!proxyInstance || !proxyPort) return null;
  return { port: proxyPort, ...proxyInstance.stats };
}

/**
 * Check if the proxy is running by hitting the health endpoint.
 * @returns {Promise<boolean>}
 */
export async function isProxyRunning() {
  if (!proxyInstance || !proxyPort) return false;

  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${proxyPort}/_kj/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    // Tight timeout — should be instant for localhost
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Build the result object for startProxy.
 * @param {number} port
 * @returns {{port: number, baseUrls: {anthropic: string, openai: string, gemini: string}}}
 */
function buildResult(port) {
  const base = `http://127.0.0.1:${port}`;
  return {
    port,
    baseUrls: {
      anthropic: base,
      openai: base,
      gemini: base,
    },
  };
}
