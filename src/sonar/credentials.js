/**
 * Load SonarQube admin credentials from ~/.karajan/sonar-credentials.json.
 *
 * File format:
 * {
 *   "user": "admin",
 *   "password": "your-password"
 * }
 *
 * Returns { user, password } or { user: null, password: null } if file missing.
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
      password: data.password || null
    };
  } catch { /* credentials file may not exist */
    return { user: null, password: null };
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
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), "utf8");
}
