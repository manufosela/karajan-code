import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseQuotaSimulationConfig,
  buildSyntheticQuotaMessage,
  shouldSimulateQuota,
  applyQuotaSimulation,
  _resetSimulatorWarning,
} from "../../src/utils/quota-simulator.js";

describe("quota-simulator", () => {
  beforeEach(() => _resetSimulatorWarning());

  it("parses after-iter-<N> with defaults and overrides", () => {
    expect(parseQuotaSimulationConfig({})).toBeNull();
    const defaults = parseQuotaSimulationConfig({ KJ_SIMULATE_QUOTA: "after-iter-3" });
    expect(defaults.afterIter).toBe(3);
    expect(defaults.agent).toBe("claude");
    expect(defaults.resetIso).toMatch(/^\d{4}-/);
    expect(parseQuotaSimulationConfig({
      KJ_SIMULATE_QUOTA: "after-iter-1",
      KJ_SIMULATE_QUOTA_RESET: "2026-06-02T15:30:00Z",
      KJ_SIMULATE_QUOTA_AGENT: "Codex",
    })).toEqual({ afterIter: 1, resetIso: "2026-06-02T15:30:00Z", agent: "codex" });
  });

  it("warns once and ignores malformed values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseQuotaSimulationConfig({ KJ_SIMULATE_QUOTA: "garbage" })).toBeNull();
      expect(parseQuotaSimulationConfig({ KJ_SIMULATE_QUOTA: "garbage" })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });

  it("builds agent-specific synthetic messages, defaulting to Claude weekly-limit", () => {
    expect(buildSyntheticQuotaMessage("claude", "2026-06-02T15:30:00Z")).toMatch(/weekly limit.*2026-06-02T15:30:00Z/i);
    expect(buildSyntheticQuotaMessage("codex", "x")).toMatch(/exceeded your current quota/i);
    expect(buildSyntheticQuotaMessage("gemini", "x")).toMatch(/quota exceeded/i);
    expect(buildSyntheticQuotaMessage("unknown", "x")).toMatch(/weekly limit/i);
  });

  it("respects iteration threshold and agent filter", () => {
    const env = { KJ_SIMULATE_QUOTA: "after-iter-2" };
    expect(shouldSimulateQuota({ iteration: 1, agent: "claude" }, env)).toBeNull();
    expect(shouldSimulateQuota({ iteration: 2, agent: "claude" }, env)).not.toBeNull();
    const codexOnly = { KJ_SIMULATE_QUOTA: "after-iter-1", KJ_SIMULATE_QUOTA_AGENT: "codex" };
    expect(shouldSimulateQuota({ iteration: 5, agent: "claude" }, codexOnly)).toBeNull();
    expect(shouldSimulateQuota({ iteration: 5, agent: "codex" }, codexOnly)).not.toBeNull();
    const any = { KJ_SIMULATE_QUOTA: "after-iter-1", KJ_SIMULATE_QUOTA_AGENT: "any" };
    expect(shouldSimulateQuota({ iteration: 1, agent: "whatever" }, any)).not.toBeNull();
  });

  it("applyQuotaSimulation is a no-op when disabled or below threshold", () => {
    const r1 = { ok: true, result: { output: "hi" } };
    expect(applyQuotaSimulation(r1, { iteration: 5, agent: "claude" }, {})).toBe(false);
    expect(r1.ok).toBe(true);
    const r2 = { ok: true, result: {} };
    expect(applyQuotaSimulation(r2, { iteration: 1, agent: "claude" }, { KJ_SIMULATE_QUOTA: "after-iter-3" })).toBe(false);
    expect(r2.ok).toBe(true);
    expect(applyQuotaSimulation(null, { iteration: 1, agent: "claude" }, { KJ_SIMULATE_QUOTA: "after-iter-1" })).toBe(false);
  });

  it("applyQuotaSimulation forces ok=false and prepends synthetic line", () => {
    const env = { KJ_SIMULATE_QUOTA: "after-iter-2", KJ_SIMULATE_QUOTA_RESET: "2026-06-02T15:30:00Z" };
    const r = { ok: true, result: { error: "previous noise" } };
    expect(applyQuotaSimulation(r, { iteration: 2, agent: "claude" }, env)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.result.error).toMatch(/weekly limit.*2026-06-02T15:30:00Z/i);
    expect(r.result.error).toMatch(/previous noise/);
  });

  it("creates result object when missing", () => {
    const r = { ok: true };
    expect(applyQuotaSimulation(r, { iteration: 1, agent: "claude" }, { KJ_SIMULATE_QUOTA: "after-iter-1" })).toBe(true);
    expect(r.result.error).toMatch(/weekly limit/i);
  });
});
