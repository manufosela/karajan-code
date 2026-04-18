/**
 * Timeout wrapper for arbitrary promises.
 *
 * Produces a new Promise that resolves with the original value if the
 * underlying promise settles within `ms`, or rejects with a TimeoutError if
 * it doesn't. Intended for wrapping individual checks in the doctor/preflight
 * runner so a slow HTTP probe cannot hang the whole pipeline.
 *
 * The original promise keeps running after timeout (we cannot cancel it
 * without cooperation). Callers should avoid calling `withTimeout` on
 * side-effectful operations they need to be sure completed.
 */

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`Timeout after ${ms}ms${label ? ` (${label})` : ""}`);
    this.name = "TimeoutError";
    this.timeoutMs = ms;
    this.label = label;
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [label] - for error messages / logs
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  let timerId;
  const timeout = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    if (timerId && typeof timerId.unref === "function") timerId.unref();
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}
