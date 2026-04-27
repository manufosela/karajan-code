/**
 * Load SonarQube credentials from ~/.karajan/sonar-credentials.json.
 *
 * File format (any subset):
 * {
 *   "user": "admin",
 *   "password": "your-password",
 *   "token": "squ_..."
 * }
 *
 * Returns { user, password, token } with each field null when missing.
 *
 * The `token` field is consumed by resolveSonarTokenAsync as the
 * lowest-priority fallback. Until v2.7.5 it was not extracted here, which
 * meant a token persisted to the credentials file by `kj init` was never
 * actually used at scan time — Karajan would silently fall back to the
 * stale token in kj.config.yml or fail with a 401.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";

const CREDENTIALS_FILENAME = "sonar-credentials.json";

export async function loadSonarCredentials() {
  try {
    const filePath = path.join(getKarajanHome(), CREDENTIALS_FILENAME);
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return {
      user: data.user || null,
      password: data.password || null,
      token: data.token || null
    };
  } catch { /* credentials file may not exist */
    return { user: null, password: null, token: null };
  }
}

export function credentialsPath() {
  return path.join(getKarajanHome(), CREDENTIALS_FILENAME);
}

/**
 * Save a generated token to ~/.karajan/sonar-credentials.json so it persists across sessions.
 * Merges with existing credentials (preserves user/password if present).
 */
export async function saveSonarToken(token) {
  const filePath = path.join(getKarajanHome(), CREDENTIALS_FILENAME);
  let existing = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    existing = JSON.parse(raw);
  } catch { /* file may not exist */ }
  existing.token = token;
  const dir = getKarajanHome();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), { encoding: "utf8", mode: 0o600 });
}
