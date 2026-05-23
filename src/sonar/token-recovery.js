// Sonar 401 auto-recovery — KJC-BUG-0057 / v2.19.2.
//
// When the Sonar API returns 401 (token missing / invalid / expired / revoked)
// and we still have admin/admin (or a user/pass we saved at `kj init` time),
// regenerate the analysis token VIA THE REST API and persist it. The caller
// retries the original request once with the new token.
//
// Programmatic, no LLM involvement. The whole point of the user feedback was
// that this is plumbing, not a decision: Karajan has the credentials to
// re-bootstrap and should do it without asking.

import { bootstrapSonarToken } from "./token-bootstrap.js";
import { saveSonarToken } from "./credentials.js";

// Per-process latch: a single Sonar run that 401s on every endpoint must
// only trigger ONE bootstrap attempt — not one per endpoint. The latch
// resets when the process exits.
let _recoveryAttempted = false;

/**
 * @internal Reset the latch between tests (mirrors __resetKjHomeWarningForTests).
 */
export function __resetSonarRecoveryLatchForTests() {
  _recoveryAttempted = false;
}

/**
 * Attempt to re-bootstrap the Sonar token after a 401. Mutates `config`
 * in place when successful so the immediate retry picks up the new token.
 *
 * @param {object} config       Karajan config (will be mutated on success).
 * @param {object} [logger]
 * @returns {Promise<{ ok: boolean, reason?: string, newToken?: string, savedTo?: string, passwordRotated?: boolean }>}
 */
export async function recoverSonarToken(config, logger = null) {
  if (_recoveryAttempted) {
    return { ok: false, reason: "recovery already attempted in this process" };
  }
  _recoveryAttempted = true;

  const host = config?.sonarqube?.host || "http://localhost:9000";
  logger?.warn?.(`[sonar-recovery] 401 from ${host} — attempting token re-bootstrap`);

  const result = await bootstrapSonarToken({ host });

  if (!result.ok) {
    logger?.warn?.(`[sonar-recovery] bootstrap failed: ${result.reason}`);
    return { ok: false, reason: result.reason };
  }

  // Mutate the in-memory config so the caller's retry sees the new token.
  config.sonarqube = config.sonarqube || {};
  config.sonarqube.token = result.token;

  // Also persist to ~/.karajan/sonar-credentials.json so future processes
  // pick it up via the normal config-resolver chain instead of triggering
  // recovery again. token-bootstrap.js already wrote sonar.token; this
  // mirrors it into the structured credentials file the resolver reads.
  try {
    await saveSonarToken(result.token);
  } catch (err) {
    logger?.warn?.(`[sonar-recovery] persist to sonar-credentials.json failed (non-blocking): ${err.message}`);
  }

  logger?.info?.(`[sonar-recovery] new token persisted to ${result.savedTo}${result.passwordRotated ? " (admin password rotated)" : ""} — retrying original request`);
  return { ok: true, newToken: result.token, savedTo: result.savedTo, passwordRotated: result.passwordRotated };
}
