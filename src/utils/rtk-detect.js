import { runCommand } from "./process.js";

/**
 * Detect whether RTK (Rust Token Killer) is installed and available.
 * @returns {Promise<{ available: boolean, version: string|null }>}
 */
export async function detectRtk() {
  try {
    const result = await runCommand("rtk", ["--version"]);
    if (result.exitCode === 0) {
      const version = (result.stdout || "").trim() || null;
      return { available: true, version };
    }
    return { available: false, version: null };
  } catch { /* rtk binary not found */
    return { available: false, version: null };
  }
}
