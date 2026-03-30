/**
 * Centralized SonarQube configuration resolution.
 *
 * Single source of truth for host URL, token, and admin credentials.
 * Consumers: scanner.js, preflight-checks.js, api.js.
 */

import { loadSonarCredentials } from "./credentials.js";

const DEFAULT_HOST = "http://localhost:9000";

/**
 * Normalize SonarQube host URL for API calls (replace Docker-internal hostname).
 * @param {string|undefined} rawHost - Raw host from config or env
 * @returns {string} Normalized host URL without trailing slash
 */
export function resolveSonarHost(rawHost) {
  const host = String(rawHost || DEFAULT_HOST)
    .replace(/host\.docker\.internal/g, "localhost")
    .replace(/\/+$/, "");
  return host;
}

/**
 * Resolve SonarQube auth token from (in priority order):
 *   1. KJ_SONAR_TOKEN env var
 *   2. config.sonarqube.token
 *   3. SONAR_TOKEN env var
 *
 * @param {object} [config={}] - Karajan config object
 * @returns {string|null} Token string or null if none found
 */
export function resolveSonarToken(config = {}) {
  const token =
    process.env.KJ_SONAR_TOKEN ||
    config.sonarqube?.token ||
    process.env.SONAR_TOKEN ||
    null;
  return token || null;
}

/**
 * Resolve SonarQube admin credentials from (in priority order):
 *   1. Env vars: KJ_SONAR_ADMIN_USER / KJ_SONAR_ADMIN_PASSWORD
 *   2. Config: sonarqube.admin_user / sonarqube.admin_password
 *   3. Credentials file: ~/.karajan/sonar-credentials.json
 *
 * Returns all candidate passwords (de-duped) so callers can try each.
 *
 * @param {object} [config={}] - Karajan config object
 * @returns {Promise<{ user: string|null, passwords: string[] }>}
 */
export async function resolveSonarCredentials(config = {}) {
  const fileCreds = (await loadSonarCredentials()) || {};

  const user =
    process.env.KJ_SONAR_ADMIN_USER ||
    config.sonarqube?.admin_user ||
    fileCreds.user ||
    null;

  const candidates = [
    process.env.KJ_SONAR_ADMIN_PASSWORD,
    config.sonarqube?.admin_password,
    fileCreds.password,
  ].filter(Boolean);

  return { user, passwords: [...new Set(candidates)] };
}
