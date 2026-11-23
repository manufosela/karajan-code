/**
 * HU-4775 layer 1, the seam: when a span is wanted and what it may carry.
 * Dependency-free on purpose: off means nothing is imported, no socket, no file.
 * The tracer itself (lazy SDK import) comes in the next slice and reads this.
 */
const MAX_VALUE_LENGTH = 200;

/** Allow-list: span attribute name -> the usage-record field it comes from. Never prompts, code or keys. */
const ATTRIBUTE_SOURCES = {
  "kj.card": "card",
  "kj.role": "role",
  "kj.outcome": "outcome",
  "kj.provider": "provider",
  "kj.model": "model",
  "kj.duration_ms": "durationMs",
  "kj.tokens_in": "tokensIn",
  "kj.tokens_out": "tokensOut",
  "kj.cost_usd": "costUsd"
};
export const SPAN_ATTRIBUTES = Object.keys(ATTRIBUTE_SOURCES);

/** Opt-in through the standard variables: an OTLP endpoint, unless OTEL_SDK_DISABLED says no. */
export function otelEnabled(env = process.env) {
  if (String(env.OTEL_SDK_DISABLED ?? "").toLowerCase() === "true") return false;
  return String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim() !== "";
}

const isAllowedValue = (value) =>
  typeof value === "number" || typeof value === "boolean" ||
  (typeof value === "string" && value.length <= MAX_VALUE_LENGTH);

/** The attributes a span carries: only allow-listed fields holding short primitives. */
export function spanAttributes(fields = {}) {
  const attributes = {};
  for (const [name, source] of Object.entries(ATTRIBUTE_SOURCES)) {
    if (isAllowedValue(fields[source])) attributes[name] = fields[source];
  }
  return attributes;
}

/** A sample span for `kj telemetry preview`: the exact shape a role call would export. */
export function previewSpan() {
  return {
    name: "kj.role.coder",
    attributes: spanAttributes({
      card: "HU-0000", role: "coder", outcome: "ok", provider: "claude",
      model: "sonnet", durationMs: 42000, tokensIn: 1200, tokensOut: 300, costUsd: 0.02
    })
  };
}
