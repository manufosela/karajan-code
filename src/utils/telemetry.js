export const TELEMETRY_ENDPOINT = "https://karajan-code.web.app/api/telemetry";

/**
 * Build the exact JSON payload that would be POSTed for an event.
 * Pure function: deterministic given (eventName, data) — exposed so
 * `kj telemetry preview` can render the literal bytes the backend
 * receives without performing any network call.
 *
 * The `data.version` field is folded into `v`; the rest of the
 * event-specific keys ride through `...data` after the common ones,
 * matching the order sent over the wire.
 *
 * @param {string} eventName
 * @param {object} [data]
 * @returns {object}
 */
export function buildTelemetryPayload(eventName, data = {}) {
  const { version, ...rest } = data;
  return {
    event: eventName,
    v: version || "unknown",
    os: process.platform,
    node: process.version,
    ts: Date.now(),
    ...rest
  };
}

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
    const payload = buildTelemetryPayload(eventName, data);
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
  } catch (err) {
    // Audit follow-up: was a silent catch{}. Telemetry MUST stay
    // fire-and-forget (never block the user's pipeline, never throw),
    // but completely silent failures hide DNS/network bugs that matter
    // when debugging the telemetry pipeline itself. Surface the error
    // to stderr only when KJ_DEBUG=1 is explicitly set, so normal runs
    // are still silent.
    if (process.env.KJ_DEBUG === "1") {
      // Stderr (not console — telemetry runs from CLI commands and is
      // legitimate user-visible diagnostic output under KJ_DEBUG).
      process.stderr.write(`[telemetry-debug] ${eventName}: ${err.message}\n`);
    }
  }
}

/**
 * Check if telemetry is enabled (opt-in model).
 *
 * Returns true ONLY when the user explicitly answered "yes" in the
 * `kj init` wizard and we persisted `telemetry: true` to their config.
 * Anything else — undefined, null, missing key, false — disables sending.
 *
 * @param {object} [config] - Karajan config
 * @returns {boolean}
 */
export function isTelemetryEnabled(config) {
  return config?.telemetry === true;
}
