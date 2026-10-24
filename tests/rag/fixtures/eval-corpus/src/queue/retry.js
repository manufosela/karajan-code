// Retries with exponential backoff for flaky downstream calls.

/** Delay before attempt n: base doubles each time, capped, with a little jitter. */
export function backoffDelay(attempt, { baseMs = 200, maxMs = 10_000, jitter = 0.1 } = {}) {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(raw * (1 + (Math.random() * 2 - 1) * jitter));
}

/** Run fn until it resolves or the attempts run out; the last error is thrown. */
export async function withRetry(fn, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(backoffDelay(i));
    }
  }
  throw lastError;
}
