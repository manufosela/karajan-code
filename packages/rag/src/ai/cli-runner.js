// @ts-check
import { spawn } from 'node:child_process';

/**
 * @typedef {Object} CliRunOptions
 * @property {string[]} [args] Arguments passed to the CLI binary.
 * @property {string} [cwd] Working directory for the spawned process.
 * @property {NodeJS.ProcessEnv} [env] Environment variables merged with process.env.
 * @property {number} [timeoutMs] Maximum execution time in milliseconds.
 * @property {string} [stdinText] Text written to the child process stdin.
 */

/**
 * @typedef {Object} CliRunResult
 * @property {string} stdout Captured stdout text.
 * @property {string} stderr Captured stderr text.
 * @property {number | null} exitCode Exit code reported by the process.
 * @property {NodeJS.Signals | null} signal Signal that terminated the process (if any).
 * @property {boolean} timedOut Whether the process was killed due to a timeout.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Execute an external CLI command using spawn and return a normalized result.
 * This runner is intentionally provider-agnostic: no Codex/Claude/Gemini logic here.
 *
 * @param {string} command Binary to execute (e.g. "codex", "claude", "gemini").
 * @param {CliRunOptions} [options]
 * @returns {Promise<CliRunResult>}
 */
export function runCli(command, options = {}) {
  const {
    args = [],
    cwd,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stdinText,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnError) {
      reject(spawnError);
      return;
    }

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let timedOut = false;
    let timeoutHandle = null;

    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        // Intento grácil primero; si no muere, SIGKILL lo forzará en la práctica del OS.
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on('close', (exitCode, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        signal,
        timedOut,
      });
    });

    if (typeof stdinText === 'string' && child.stdin) {
      child.stdin.end(stdinText);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
