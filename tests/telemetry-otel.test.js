import { describe, it, expect, vi } from "vitest";
import { otelEnabled, spanAttributes, previewSpan, SPAN_ATTRIBUTES } from "../src/telemetry/otel.js";
import { telemetryPreviewCommand } from "../src/commands/telemetry.js";

describe("otelEnabled (opt-in, standard variables)", () => {
  it("is off without an OTLP endpoint", () => {
    expect(otelEnabled({})).toBe(false);
    expect(otelEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBe(false);
  });
  it("is on with an endpoint", () => {
    expect(otelEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" })).toBe(true);
  });
  it("OTEL_SDK_DISABLED wins over the endpoint", () => {
    expect(otelEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", OTEL_SDK_DISABLED: "true" })).toBe(false);
  });
});

describe("spanAttributes (privacy allow-list)", () => {
  it("keeps only the allowed identifiers, durations and outcomes", () => {
    const attributes = spanAttributes({
      card: "HU-1", role: "coder", outcome: "ok", durationMs: 12, provider: "claude",
      prompt: "secret prompt", code: "const a = 1", env: { A: "b" }
    });
    expect(attributes).toEqual({ "kj.card": "HU-1", "kj.role": "coder", "kj.outcome": "ok", "kj.duration_ms": 12, "kj.provider": "claude" });
  });
  it("drops non-primitive values and over-long strings", () => {
    expect(spanAttributes({ card: { id: 1 }, role: "x".repeat(500) })).toEqual({});
  });
  it("never lists a prompt, code or key attribute", () => {
    expect(SPAN_ATTRIBUTES.join(" ")).not.toMatch(/prompt|code|key|secret|token_value/);
  });
});

describe("kj telemetry preview, OpenTelemetry section", () => {
  it("shows the exact attributes and says nothing is sent", async () => {
    const logger = { info: vi.fn() };
    const preview = await telemetryPreviewCommand({ config: {}, logger, version: "1.0.0", json: false });
    expect(preview.otel.attributes).toEqual(previewSpan().attributes);
    const text = logger.info.mock.calls.map((call) => call[0]).join("\n");
    expect(text).toContain("OpenTelemetry");
    expect(text).toContain("kj.role");
  });
});
