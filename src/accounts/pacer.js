/**
 * HU-4591 (ADR 0064): pacing per account. A gap since the last call ended, a maximum of calls at once,
 * and a wait after a limit message. The state lives in this kj process only: another kj process
 * running on the same account paces itself, it does not see this one.
 */
import { detectRateLimit } from "../utils/rate-limit-detector.js";

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPacer({ sleep = realSleep, now = Date.now } = {}) {
  const states = new Map();
  const stateOf = (id) => {
    if (!states.has(id)) states.set(id, { active: 0, waiters: [], nextAllowed: 0 });
    return states.get(id);
  };

  async function acquire(state, maxConcurrent) {
    while (state.active >= maxConcurrent) await new Promise((resolve) => state.waiters.push(resolve));
    state.active += 1;
    for (let wait = state.nextAllowed - now(); wait > 0; wait = state.nextAllowed - now()) await sleep(wait);
  }

  /** Runs fn once the account has a free slot and its gap has passed. */
  async function run(accountId, pace, fn) {
    if (!pace) return fn();
    const { gapSeconds = 0, maxConcurrent = Infinity, limitWaitSeconds = 0 } = pace;
    const state = stateOf(accountId);
    await acquire(state, maxConcurrent);
    let seconds = gapSeconds;
    try {
      const result = await fn();
      if (detectRateLimit(result ?? {}).isRateLimit) seconds = Math.max(gapSeconds, limitWaitSeconds);
      return result;
    } finally {
      state.nextAllowed = Math.max(state.nextAllowed, now() + seconds * 1000);
      state.active -= 1;
      state.waiters.shift()?.();
    }
  }

  return { run };
}

export const pacer = createPacer();
