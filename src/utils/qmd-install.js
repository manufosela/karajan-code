import { runCommand } from "./process.js";
import { getInstallCommand } from "./os-detect.js";
import { detectQmd } from "./qmd-detect.js";

/**
 * Install QMD using the OS-appropriate command.
 * @param {object} logger - Logger with info/warn methods
 * @returns {Promise<{ ok: boolean, version: string|null, error: string|null }>}
 */
export async function installQmd(logger) {
  const command = getInstallCommand("qmd");

  logger.info("Installing QMD...");

  try {
    const result = await runCommand("sh", ["-c", command], { timeout: 120_000 });

    if (result.exitCode !== 0) {
      const error = (result.stderr || "").trim() || `exit code ${result.exitCode}`;
      logger.warn(`QMD install failed: ${error}`);
      return { ok: false, version: null, error };
    }

    const check = await detectQmd();
    if (check.available) {
      logger.info(`QMD ${check.version || ""} installed successfully.`);
      return { ok: true, version: check.version, error: null };
    }

    logger.warn("QMD install command succeeded but qmd binary not found in PATH.");
    return { ok: false, version: null, error: "Binary not found after install" };
  } catch (err) {
    const error = err.message || String(err);
    logger.warn(`QMD install failed: ${error}`);
    return { ok: false, version: null, error };
  }
}
