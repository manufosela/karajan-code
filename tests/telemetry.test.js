import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelemetryEvent, isTelemetryEnabled, buildTelemetryPayload, TELEMETRY_ENDPOINT } from "../src/utils/telemetry.js";

describe("telemetry", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("isTelemetryEnabled (opt-in)", () => {
    it("returns false when config is undefined", () => {
      expect(isTelemetryEnabled(undefined)).toBe(false);
    });

    it("returns false when config is null", () => {
      expect(isTelemetryEnabled(null)).toBe(false);
    });

    it("returns false when config has no telemetry key", () => {
      expect(isTelemetryEnabled({})).toBe(false);
    });

    it("returns true only when telemetry is explicitly true", () => {
      expect(isTelemetryEnabled({ telemetry: true })).toBe(true);
    });

    it("returns false when telemetry is false", () => {
      expect(isTelemetryEnabled({ telemetry: false })).toBe(false);
    });

    it("returns false for truthy-but-not-strict-true values", () => {
      // Guards against accidental `telemetry: 1` / `"true"` in YAML configs.
      expect(isTelemetryEnabled({ telemetry: 1 })).toBe(false);
      expect(isTelemetryEnabled({ telemetry: "true" })).toBe(false);
    });
  });

  describe("sendTelemetryEvent", () => {
    it("sends a fetch request when telemetry is enabled", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" }, { telemetry: true });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe("https://karajan-code.web.app/api/telemetry");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.event).toBe("test_event");
      expect(body.v).toBe("1.0.0");
      expect(body.os).toBe(process.platform);
      expect(body.node).toBe(process.version);
      expect(typeof body.ts).toBe("number");
    });

    it("does NOT send when config is undefined (opt-in default)", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does NOT send when config lacks the telemetry key", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" }, {});

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("skips when telemetry is false", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" }, { telemetry: false });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does not throw on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

      await expect(
        sendTelemetryEvent("test_event", { version: "1.0.0" }, { telemetry: true })
      ).resolves.toBeUndefined();
    });

    it("does not throw on abort (timeout)", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 10);
        })
      );

      await expect(
        sendTelemetryEvent("test_event", { version: "1.0.0" }, { telemetry: true })
      ).resolves.toBeUndefined();
    });

    it("includes extra data fields in the payload", async () => {
      await sendTelemetryEvent("pipeline_complete", {
        version: "1.5.0",
        mode: "standard",
        agent: "claude",
        duration_s: 120,
        success: true,
        taskType: "sw"
      }, { telemetry: true });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.mode).toBe("standard");
      expect(body.agent).toBe("claude");
      expect(body.duration_s).toBe(120);
      expect(body.success).toBe(true);
      expect(body.taskType).toBe("sw");
    });

    it("defaults version to 'unknown' when not provided", async () => {
      await sendTelemetryEvent("test_event", {}, { telemetry: true });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.v).toBe("unknown");
    });

    it("uses abort signal with 3s timeout", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" }, { telemetry: true });

      const opts = global.fetch.mock.calls[0][1];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("buildTelemetryPayload (KJC-TSK-0496)", () => {
    it("exports the canonical endpoint", () => {
      expect(TELEMETRY_ENDPOINT).toBe("https://karajan-code.web.app/api/telemetry");
    });

    it("produces the same shape sendTelemetryEvent posts", () => {
      const payload = buildTelemetryPayload("cli_command", { version: "2.0.0", command: "run" });
      expect(payload.event).toBe("cli_command");
      expect(payload.v).toBe("2.0.0");
      expect(payload.os).toBe(process.platform);
      expect(payload.node).toBe(process.version);
      expect(typeof payload.ts).toBe("number");
      expect(payload.command).toBe("run");
    });

    it("defaults v to 'unknown' when version missing", () => {
      const payload = buildTelemetryPayload("install", {});
      expect(payload.v).toBe("unknown");
    });

    it("never includes a raw `version` key (it is folded into `v`)", () => {
      const payload = buildTelemetryPayload("install", { version: "3.0.0" });
      expect(payload).not.toHaveProperty("version");
      expect(payload.v).toBe("3.0.0");
    });

    it("is pure: matches the body actually sent", async () => {
      const preview = buildTelemetryPayload("test_event", { version: "1.0.0", extra: 1 });
      await sendTelemetryEvent("test_event", { version: "1.0.0", extra: 1 }, { telemetry: true });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // ts will differ by a few ms; everything else must be identical.
      expect({ ...preview, ts: 0 }).toEqual({ ...body, ts: 0 });
    });
  });
});
