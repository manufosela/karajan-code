import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelemetryEvent, isTelemetryEnabled } from "../src/utils/telemetry.js";

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

  describe("isTelemetryEnabled", () => {
    it("returns true when config is undefined", () => {
      expect(isTelemetryEnabled(undefined)).toBe(true);
    });

    it("returns true when config is null", () => {
      expect(isTelemetryEnabled(null)).toBe(true);
    });

    it("returns true when config has no telemetry key", () => {
      expect(isTelemetryEnabled({})).toBe(true);
    });

    it("returns true when telemetry is true", () => {
      expect(isTelemetryEnabled({ telemetry: true })).toBe(true);
    });

    it("returns false when telemetry is false", () => {
      expect(isTelemetryEnabled({ telemetry: false })).toBe(false);
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

    it("sends when config is undefined (opt-in by default)", async () => {
      await sendTelemetryEvent("test_event", { version: "1.0.0" });

      expect(global.fetch).toHaveBeenCalledTimes(1);
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
});
