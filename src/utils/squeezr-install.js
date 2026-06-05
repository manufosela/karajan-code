import { runCommand } from "./process.js";
import { getInstallCommand } from "./os-detect.js";
import { detectSqueezr } from "./squeezr-detect.js";

/**
 * Install Squeezr using the OS-appropriate command.
 * @param {object} logger - Logger with info/warn methods
 * @returns {Promise<{ ok: boolean, version: string|null, error: string|null }>}
 */
export async function installSqueezr(logger) {
  const command = getInstallCommand("squeezr");

  logger.info("Installing Squeezr...");

  try {
    const result = await runCommand("sh", ["-c", command], { timeout: 120_000 });

    if (result.exitCode !== 0) {
      const error = (result.stderr || "").trim() || `exit code ${result.exitCode}`;
      logger.warn(`Squeezr install failed: ${error}`);
      return { ok: false, version: null, error };
    }

    const check = await detectSqueezr();
    if (check.available) {
      logger.info(`Squeezr ${check.version || ""} installed successfully.`);
      return { ok: true, version: check.version, error: null };
    }

    logger.warn("Squeezr install command succeeded but squeezr binary not found in PATH.");
    return { ok: false, version: null, error: "Binary not found after install" };
  } catch (err) {
    const error = err.message || String(err);
    logger.warn(`Squeezr install failed: ${error}`);
    return { ok: false, version: null, error };
  }
}
