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
