import { runCommand } from "./process.js";

/**
 * Detect whether QMD is installed and available.
 * @returns {Promise<{ available: boolean, version: string|null }>}
 */
export async function detectQmd() {
  try {
    const result = await runCommand("qmd", ["--version"]);
    if (result.exitCode === 0) {
      const version = (result.stdout || "").trim() || null;
      return { available: true, version };
    }
    return { available: false, version: null };
  } catch { /* qmd binary not found */
    return { available: false, version: null };
  }
}
