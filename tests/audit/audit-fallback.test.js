import { describe, it, expect, vi } from "vitest";
import {
  buildAuditFallbackCandidates,
  withAuditProvider,
  runAuditWithFallback,
} from "../../src/audit/audit-fallback.js";

const providersOf = (c) => c.map((x) => x.provider);

describe("buildAuditFallbackCandidates", () => {
  it("no model: primary then other known providers, all default-model", () => {
    expect(buildAuditFallbackCandidates({ coder: "claude" })).toEqual([
      { provider: "claude", model: null },
      { provider: "codex", model: null },
      { provider: "gemini", model: null },
    ]);
  });

  it("inherited model (fable): keep it, then drop to provider-default, then switch provider", () => {
    expect(buildAuditFallbackCandidates({ coder: "claude", coder_options: { model: "claude-fable-5" } })).toEqual([
      { provider: "claude", model: "claude-fable-5" },
      { provider: "claude", model: null },
      { provider: "codex", model: null },
      { provider: "gemini", model: null },
    ]);
  });

  it("defaults the primary to claude when config has no provider", () => {
    expect(providersOf(buildAuditFallbackCandidates({}))).toEqual(["claude", "codex", "gemini"]);
  });
});

describe("withAuditProvider", () => {
  it("neutralizes roles.audit.model and coder_options.model when model is null", () => {
    const cfg = withAuditProvider({ coder_options: { model: "claude-fable-5" }, roles: { audit: { model: "claude-fable-5" } } }, "codex", null);
    expect(cfg.roles.audit.provider).toBe("codex");
    expect(cfg.roles.audit.model).toBeUndefined();
    expect(cfg.coder_options.model).toBeUndefined();
  });

  it("pins the model on both buckets when one is given", () => {
    const cfg = withAuditProvider({}, "claude", "claude-fable-5");
    expect(cfg.roles.audit).toEqual({ provider: "claude", model: "claude-fable-5" });
    expect(cfg.coder_options.model).toBe("claude-fable-5");
  });
});

describe("runAuditWithFallback", () => {
  // Fake role factory: each role reads its provider from the overridden
  // config and returns the scripted result (value or throwing thunk).
  const factory = (scripts) => (cfg) => ({
    executeWithDeterministic: async () => {
      const r = scripts[cfg.roles.audit.provider];
      return typeof r === "function" ? r() : r;
    },
  });
  const run = (createRole, available, onFallback, config = { coder: "claude" }) =>
    runAuditWithFallback({ config, roleInput: {}, deterministicCtx: {}, available, onFallback, createRole });

  it("returns the first ok result and counts attempts; thrown errors are just failed candidates", async () => {
    const onFallback = vi.fn();
    const res = await run(factory({
      claude: () => { throw new Error("model claude-fable-5 unavailable"); },
      codex: { ok: true, result: { summary: { overallHealth: "B" } } },
    }), ["claude", "codex", "gemini"], onFallback, { coder: "claude", coder_options: { model: "claude-fable-5" } });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("codex"); // claude(fable) throws → claude(default) throws → codex ok
    expect(res.attempts).toBe(3);
    expect(onFallback).toHaveBeenCalled();
  });

  it("marks the run exhausted when every candidate fails", async () => {
    const res = await run(factory({
      claude: { ok: false, result: { error: "x" } },
      codex: { ok: false, result: { error: "y" } },
      gemini: { ok: false, result: { error: "z" } },
    }), ["claude", "codex", "gemini"]);
    expect(res.ok).toBe(false);
    expect(res.exhausted).toBe(true);
  });

  it("skips providers that are not installed", async () => {
    const tried = [];
    await run((cfg) => ({
      executeWithDeterministic: async () => { tried.push(cfg.roles.audit.provider); return { ok: true, result: {} }; },
    }), ["codex"]);
    expect(tried).toEqual(["codex"]);
  });

  it("throws when no candidate provider is available", async () => {
    await expect(run(factory({}), [])).rejects.toThrow(/no available audit provider/i);
  });
});
