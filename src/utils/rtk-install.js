import { runCommand } from "./process.js";
import { getInstallCommand } from "./os-detect.js";
import { detectRtk } from "./rtk-detect.js";

/**
 * Install RTK (Rust Token Killer) using the OS-appropriate command.
 * @param {object} logger - Logger with info/warn methods
 * @returns {Promise<{ ok: boolean, version: string|null, error: string|null }>}
 */
export async function installRtk(logger) {
  const command = getInstallCommand("rtk");

  logger.info("Installing RTK (Rust Token Killer)...");

  try {
    const result = await runCommand("sh", ["-c", command], { timeout: 120_000 });

    if (result.exitCode !== 0) {
      const error = (result.stderr || "").trim() || `exit code ${result.exitCode}`;
      logger.warn(`RTK install failed: ${error}`);
      return { ok: false, version: null, error };
    }

    // Verify installation
    const check = await detectRtk();
    if (check.available) {
      logger.info(`RTK ${check.version || ""} installed successfully.`);
      return { ok: true, version: check.version, error: null };
    }

    logger.warn("RTK install command succeeded but rtk binary not found in PATH.");
    return { ok: false, version: null, error: "Binary not found after install" };
  } catch (err) {
    const error = err.message || String(err);
    logger.warn(`RTK install failed: ${error}`);
    return { ok: false, version: null, error };
  }
}
