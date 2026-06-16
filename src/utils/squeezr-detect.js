import { runCommand } from "./process.js";

/**
 * Detect whether Squeezr is installed and available.
 * @returns {Promise<{ available: boolean, version: string|null }>}
 */
export async function detectSqueezr() {
  try {
    const result = await runCommand("squeezr", ["--version"]);
    if (result.exitCode === 0) {
      // `squeezr --version` may append an "update available" banner box; keep
      // just the semver so callers never render that noise (KJC-BUG-0088).
      const raw = (result.stdout || "").trim();
      const version = raw.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] || raw.split("\n")[0].trim() || null;
      return { available: true, version };
    }
    return { available: false, version: null };
  } catch { /* squeezr binary not found */
    return { available: false, version: null };
  }
}
