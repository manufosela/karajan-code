import { emitProgress, makeEvent } from "../utils/events.js";
import { setStatus } from "../session/mutators.js";

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_STANDBY_RETRIES = 5;
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Wait for a rate limit cooldown, emitting heartbeat events.
 * Returns when the cooldown expires.
 *
 * @param {object} options
 * @param {number|null} options.cooldownMs - Milliseconds to wait (null = use default)
 * @param {string|null} options.cooldownUntil - ISO timestamp when cooldown expires
 * @param {string} options.agent - Agent that was rate-limited
 * @param {number} options.retryCount - Current retry attempt (for backoff)
 * @param {object} options.emitter - Event emitter
 * @param {object} options.eventBase - Base event fields
 * @param {object} options.logger
 * @param {object} options.session
 */
export async function waitForCooldown({ cooldownMs, cooldownUntil, agent, retryCount, emitter, eventBase, logger, session }) {
  // Calculate wait time with exponential backoff for retries without known cooldown
  let waitMs = cooldownMs || DEFAULT_COOLDOWN_MS;
  if (!cooldownMs && retryCount > 0) {
    waitMs = Math.min(DEFAULT_COOLDOWN_MS * Math.pow(2, retryCount), MAX_COOLDOWN_MS);
  }

  const resumeAt = cooldownUntil || new Date(Date.now() + waitMs).toISOString();

  logger.info(`Standby: waiting ${Math.round(waitMs / 1000)}s for ${agent} rate limit (retry ${retryCount + 1}/${MAX_STANDBY_RETRIES})`);

  // Emit standby start event
  emitProgress(emitter, makeEvent("coder:standby", { ...eventBase, stage: "standby" }, {
    message: `Rate limited — standby until ${resumeAt} (attempt ${retryCount + 1}/${MAX_STANDBY_RETRIES})`,
    detail: { agent, cooldownUntil: resumeAt, cooldownMs: waitMs, retryCount: retryCount + 1, maxRetries: MAX_STANDBY_RETRIES }
  }));

  // Update session status
  setStatus(session, "standby");

  // Wait with periodic heartbeats
  const startTime = Date.now();
  const endTime = startTime + waitMs;

  while (Date.now() < endTime) {
    const remaining = endTime - Date.now();
    const sleepTime = Math.min(HEARTBEAT_INTERVAL_MS, remaining);

    await new Promise(resolve => setTimeout(resolve, sleepTime));

    if (Date.now() < endTime) {
      const remainingSec = Math.round((endTime - Date.now()) / 1000);
      emitProgress(emitter, makeEvent("coder:standby_heartbeat", { ...eventBase, stage: "standby" }, {
        message: `Standby: ${remainingSec}s remaining`,
        detail: { agent, remainingMs: endTime - Date.now(), retryCount: retryCount + 1 }
      }));
    }
  }

  // Emit resume event
  emitProgress(emitter, makeEvent("coder:standby_resume", { ...eventBase, stage: "standby" }, {
    message: `Cooldown expired — resuming with ${agent}`,
    detail: { agent, retryCount: retryCount + 1 }
  }));

  setStatus(session, "running");
}

export { DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, MAX_STANDBY_RETRIES, HEARTBEAT_INTERVAL_MS };
