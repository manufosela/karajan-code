import { describe, expect, it, beforeEach } from "vitest";

describe("session/runtime-overrides", () => {
  let mod;

  beforeEach(async () => {
    // Fresh module per test so the in-memory store starts clean.
    // vi.resetModules() is overkill here — the module itself exports a
    // `clearRuntimeOverrides()` that does the same thing explicitly.
    mod = await import("../../src/session/runtime-overrides.js");
    mod.clearRuntimeOverrides();
  });

  it("getRuntimeOverrides() returns {} before anything is set", () => {
    expect(mod.getRuntimeOverrides()).toEqual({});
  });

  it("setRuntimeOverride writes, getRuntimeOverrides reads", () => {
    mod.setRuntimeOverride("coder", "claude");
    mod.setRuntimeOverride("reviewer", "codex");
    expect(mod.getRuntimeOverrides()).toEqual({ coder: "claude", reviewer: "codex" });
  });

  it("getRuntimeOverrides returns a shallow copy (caller mutation is isolated)", () => {
    mod.setRuntimeOverride("coder", "claude");
    const snapshot = mod.getRuntimeOverrides();
    snapshot.coder = "tampered";
    expect(mod.getRuntimeOverrides().coder).toBe("claude");
  });

  it("setRuntimeOverride silently rejects empty/nullish keys", () => {
    mod.setRuntimeOverride("", "claude");
    mod.setRuntimeOverride(null, "claude");
    mod.setRuntimeOverride(undefined, "claude");
    expect(mod.getRuntimeOverrides()).toEqual({});
  });

  it("clearRuntimeOverrides wipes the store", () => {
    mod.setRuntimeOverride("coder", "claude");
    mod.setRuntimeOverride("reviewer", "codex");
    mod.clearRuntimeOverrides();
    expect(mod.getRuntimeOverrides()).toEqual({});
  });
});

describe("mcp/preflight — thin facade over runtime-overrides", () => {
  it("ackPreflight transfers its overrides arg into runtime-overrides", async () => {
    const pre = await import("../../src/mcp/preflight.js");
    const rt = await import("../../src/session/runtime-overrides.js");
    rt.clearRuntimeOverrides();
    pre.resetPreflight();

    pre.ackPreflight({ coder: "gemini", planner: "claude" });
    expect(pre.isPreflightAcked()).toBe(true);
    expect(rt.getRuntimeOverrides()).toEqual({ coder: "gemini", planner: "claude" });
  });

  it("resetPreflight clears both the ack flag and the overrides", async () => {
    const pre = await import("../../src/mcp/preflight.js");
    const rt = await import("../../src/session/runtime-overrides.js");

    pre.ackPreflight({ coder: "claude" });
    pre.resetPreflight();

    expect(pre.isPreflightAcked()).toBe(false);
    expect(rt.getRuntimeOverrides()).toEqual({});
  });

  it("setSessionOverride back-compat alias writes to runtime-overrides", async () => {
    const pre = await import("../../src/mcp/preflight.js");
    const rt = await import("../../src/session/runtime-overrides.js");
    rt.clearRuntimeOverrides();

    pre.setSessionOverride("coder", "codex");
    expect(rt.getRuntimeOverrides()).toEqual({ coder: "codex" });
  });

  it("getSessionOverrides back-compat alias reads from runtime-overrides", async () => {
    const pre = await import("../../src/mcp/preflight.js");
    const rt = await import("../../src/session/runtime-overrides.js");
    rt.clearRuntimeOverrides();
    rt.setRuntimeOverride("reviewer", "gemini");

    expect(pre.getSessionOverrides()).toEqual({ reviewer: "gemini" });
  });
});
