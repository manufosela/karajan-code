import { applyRunOverrides, loadConfig, validateConfig } from "../config.js";
import { createLogger } from "../utils/logger.js";

/**
 * Wraps a CLI action so it loads + validates config, builds the logger,
 * and fires the anonymous cli_command telemetry event before invoking
 * the real command body. Shared across every register-*.js module so
 * each one doesn't need to re-import the config plumbing.
 *
 * @param {string} pkgVersion       Current kj version (used for telemetry).
 * @param {string} commandName      The CLI command name being executed.
 * @param {object} flags            Flags parsed by Commander.
 * @param {(ctx: { config: object, logger: object, flags: object }) => Promise<any>} fn
 *                                  Body of the command — receives the merged config + logger.
 */
export async function withConfig(pkgVersion, commandName, flags, fn) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, flags || {});
  validateConfig(merged, commandName);
  const logger = createLogger(merged.output.log_level);

  // Telemetry: anonymous cli_command event (non-blocking).
  import("../utils/telemetry.js")
    .then(({ sendTelemetryEvent }) =>
      sendTelemetryEvent("cli_command", { command: commandName, version: pkgVersion }, merged)
    )
    .catch(() => {});

  return fn({ config: merged, logger, flags });
}
