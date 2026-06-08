import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelemetryEvent, isTelemetryEnabled, buildTelemetryPayload, TELEMETRY_ENDPOINT, computeCachedPct } from "../src/utils/telemetry.js";

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

  // -------------------------------------------------------------------------
  // Φ0-H (KJC-TSK-0526): cached_pct_{coder,reviewer,total} aggregator.
  // The fleet's pipeline_complete event needs per-role cache-hit ratios so we
  // can see how much the provider-level caches are buying in real runs, not
  // just locally. Provider-agnostic — works whether the run used Anthropic,
  // OpenAI/Codex, Gemini, aider or opencode (BudgetTracker normalises).
  // -------------------------------------------------------------------------
  describe("computeCachedPct (KJC-TSK-0526)", () => {
    it("returns nulls when summary is missing/invalid (no signal)", () => {
      expect(computeCachedPct(null)).toEqual({
        cached_pct_coder: null, cached_pct_reviewer: null, cached_pct_total: null,
      });
      expect(computeCachedPct(undefined)).toEqual({
        cached_pct_coder: null, cached_pct_reviewer: null, cached_pct_total: null,
      });
      expect(computeCachedPct("nope")).toEqual({
        cached_pct_coder: null, cached_pct_reviewer: null, cached_pct_total: null,
      });
    });

    it("computes per-role 1-decimal ratios and total", () => {
      const out = computeCachedPct({
        breakdown_by_role: {
          coder: { tokens_in: 1000, cached_tokens: 350 },
          reviewer: { tokens_in: 500, cached_tokens: 50 },
        },
      });
      expect(out.cached_pct_coder).toBe(35);
      expect(out.cached_pct_reviewer).toBe(10);
      // total = (350+50) / (1000+500) = 400/1500 ≈ 26.7
      expect(out.cached_pct_total).toBe(26.7);
    });

    it("returns null for a role with tokens_in=0 (ratio undefined, not 0)", () => {
      const out = computeCachedPct({
        breakdown_by_role: {
          coder: { tokens_in: 0, cached_tokens: 0 },
          reviewer: { tokens_in: 200, cached_tokens: 50 },
        },
      });
      expect(out.cached_pct_coder).toBeNull();
      expect(out.cached_pct_reviewer).toBe(25);
      expect(out.cached_pct_total).toBe(25);
    });

    it("returns null per absent role rather than 0", () => {
      const out = computeCachedPct({
        breakdown_by_role: {
          coder: { tokens_in: 100, cached_tokens: 30 },
        },
      });
      expect(out.cached_pct_coder).toBe(30);
      expect(out.cached_pct_reviewer).toBeNull();
      expect(out.cached_pct_total).toBe(30);
    });

    it("does not send when telemetry is off (caller is responsible — no payload by side effect)", async () => {
      // The function itself is pure; verify the gating happens upstream
      // via sendTelemetryEvent with telemetry=false (existing pattern).
      await sendTelemetryEvent("pipeline_complete", {
        version: "1.0.0",
        cached_pct_coder: 35,
        cached_pct_reviewer: 10,
        cached_pct_total: 26.7,
      }, { telemetry: false });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("includes the three cached_pct_* fields in the wire payload when present", async () => {
      await sendTelemetryEvent("pipeline_complete", {
        version: "1.0.0",
        mode: "standard",
        agent: "claude",
        duration_s: 42,
        success: true,
        cached_pct_coder: 35,
        cached_pct_reviewer: 10,
        cached_pct_total: 26.7,
      }, { telemetry: true });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.cached_pct_coder).toBe(35);
      expect(body.cached_pct_reviewer).toBe(10);
      expect(body.cached_pct_total).toBe(26.7);
    });
  });
});
