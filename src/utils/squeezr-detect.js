import { runCommand } from "./process.js";

/**
 * Detect whether Squeezr is installed and available.
 * @returns {Promise<{ available: boolean, version: string|null }>}
 */
export async function detectSqueezr() {
  try {
    const result = await runCommand("squeezr", ["--version"]);
    if (result.exitCode === 0) {
      const version = (result.stdout || "").trim() || null;
      return { available: true, version };
    }
    return { available: false, version: null };
  } catch { /* squeezr binary not found */
    return { available: false, version: null };
  }
}
