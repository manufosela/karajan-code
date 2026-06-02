import { TELEMETRY_ENDPOINT, buildTelemetryPayload, isTelemetryEnabled } from "../utils/telemetry.js";

/**
 * Render the exact payload that would be POSTed for every event type.
 *
 * Read-only by design: this never opens a socket. It exists so users
 * can inspect what telemetry sends before (or after) opting in,
 * without grepping the source. The contract here MUST stay in sync
 * with the producers in src/cli/_shared.js and the pipeline emitter
 * in src/orchestrator/flow-runner.js — if a new field appears there,
 * mirror it in the example below.
 */
function buildPreview(version) {
  const v = version || "x.y.z";
  return {
    endpoint: TELEMETRY_ENDPOINT,
    events: [
      buildTelemetryPayload("install", { version: v }),
      buildTelemetryPayload("cli_command", { version: v, command: "run" }),
      buildTelemetryPayload("pipeline_complete", {
        version: v,
        mode: "standard",
        agent: "claude",
        duration_s: 42,
        success: true,
        taskType: "feature"
      })
    ]
  };
}

export async function telemetryPreviewCommand({ config, logger, version, json }) {
  const preview = buildPreview(version);
  if (json) {
    logger.info(JSON.stringify(preview, null, 2));
    return preview;
  }
  const enabled = isTelemetryEnabled(config);
  logger.info(`Telemetry endpoint: ${preview.endpoint}`);
  logger.info(`Telemetry enabled:  ${enabled ? "yes" : "no"}`);
  logger.info("");
  logger.info("Exact payloads that would be POSTed (one per event type):");
  logger.info("");
  for (const payload of preview.events) {
    logger.info(`  [${payload.event}]`);
    logger.info(`    ${JSON.stringify(payload)}`);
    logger.info("");
  }
  logger.info("No data was sent — `kj telemetry preview` never opens a socket.");
  return preview;
}

export async function telemetryStatusCommand({ config, logger, json }) {
  const enabled = isTelemetryEnabled(config);
  const report = {
    enabled,
    endpoint: TELEMETRY_ENDPOINT,
    flipHint: enabled
      ? "Set `telemetry: false` in ~/.karajan/kj.config.yml (or re-run `kj init`) to turn it off."
      : "Set `telemetry: true` in ~/.karajan/kj.config.yml (or re-run `kj init`) to turn it on."
  };
  if (json) {
    logger.info(JSON.stringify(report, null, 2));
    return report;
  }
  logger.info(`Telemetry: ${enabled ? "enabled" : "disabled"}`);
  logger.info(`Endpoint:  ${report.endpoint}`);
  logger.info(report.flipHint);
  return report;
}
