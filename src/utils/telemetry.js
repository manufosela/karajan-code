const TELEMETRY_ENDPOINT = "https://karajan-code.web.app/api/telemetry";

/**
 * Send an anonymous telemetry event. Non-blocking, fire-and-forget.
 * Never throws, never blocks the pipeline.
 *
 * @param {string} eventName - Event name (e.g. "install", "pipeline_complete", "cli_command")
 * @param {object} data - Event-specific data
 * @param {object} [config] - Karajan config (checked for telemetry opt-out)
 */
export async function sendTelemetryEvent(eventName, data, config) {
  if (!isTelemetryEnabled(config)) return;

  try {
    const payload = {
      event: eventName,
      v: data.version || "unknown",
      os: process.platform,
      node: process.version,
      ts: Date.now(),
      ...data
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch { /* never block, never fail */ }
}

/**
 * Check if telemetry is enabled (opt-out model).
 * Returns false only when the user explicitly sets telemetry: false.
 *
 * @param {object} [config] - Karajan config
 * @returns {boolean}
 */
export function isTelemetryEnabled(config) {
  return config?.telemetry !== false;
}
