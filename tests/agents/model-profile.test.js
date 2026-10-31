// KJC-TSK-0699 (MR-B): named model profiles (frugal, standard, deep) so the user
// talks of profiles, not model ids. Resolution: flag > roles.<role>.model >
// profile > the CLI's own default. The reviewer never goes below standard.
import { describe, it, expect } from "vitest";
import { applyRunOverrides } from "../../src/config/overrides.js";
import { MODEL_PROFILES, formatModelProfile } from "../../src/utils/model-selector.js";

const base = { coder: "claude", reviewer: "claude", roles: { coder: { provider: "claude" }, reviewer: { provider: "claude" } } };

describe("model profiles", () => {
  it("three named profiles over the router's levels", () => {
    expect(MODEL_PROFILES).toEqual({ frugal: "trivial", standard: "medium", deep: "complex" });
  });

  it("modelProfile frugal gives each role the profile's model for its provider; the reviewer stays at standard", () => {
    const out = applyRunOverrides(base, { modelProfile: "frugal" });
    expect(out.roles.coder.model).toBe("haiku");
    expect(out.roles.reviewer.model).toBe("sonnet");
    expect(out.model_profile).toBe("frugal");
  });

  it("an inherited role takes the coder's provider", () => {
    expect(applyRunOverrides(base, { modelProfile: "deep" }).roles.planner.model).toBe("opus");
  });

  // KJC-BUG-0448: harden and check use --profile for the HARNESS (minimal | standard | strict);
  // read as a model profile it crashed `kj harden --profile minimal`.
  it("the harness --profile of harden and check is never read as a model profile", () => {
    for (const harness of ["minimal", "standard", "strict"]) {
      const out = applyRunOverrides(base, { profile: harness });
      expect(out.model_profile ?? null).toBeNull();
      expect(out.roles.coder.model ?? null).toBeNull();
    }
  });

  it("a model flag and roles.<role>.model win over the profile", () => {
    const cfg = { ...base, roles: { ...base.roles, reviewer: { provider: "claude", model: "claude-opus-5-5" } } };
    const out = applyRunOverrides(cfg, { modelProfile: "frugal", coderModel: "claude-sonnet-5-5" });
    expect(out.roles.coder.model).toBe("claude-sonnet-5-5");
    expect(out.roles.reviewer.model).toBe("claude-opus-5-5");
  });

  it("model_profile in the config applies too, and the flag overrides it", () => {
    expect(applyRunOverrides({ ...base, model_profile: "deep" }, {}).roles.coder.model).toBe("opus");
    expect(applyRunOverrides({ ...base, model_profile: "deep" }, { modelProfile: "frugal" }).roles.coder.model).toBe("haiku");
  });

  it("no profile leaves every model to the CLI, and an unknown one fails loudly", () => {
    expect(applyRunOverrides(base, {}).roles.coder.model ?? null).toBeNull();
    expect(() => applyRunOverrides(base, { modelProfile: "cheap" })).toThrow(/profile "cheap".*frugal, standard, deep/);
  });

  it("a profile never leaks into the shipped defaults (the next run starts clean)", async () => {
    const { DEFAULTS } = await import("../../src/config/defaults.js");
    applyRunOverrides(base, { modelProfile: "deep" });
    expect(DEFAULTS.roles.planner.model).toBeNull();
    expect(applyRunOverrides(base, {}).roles.planner.model ?? null).toBeNull();
  });

  it("kj config names the effective profile", () => {
    expect(formatModelProfile({ model_profile: "deep" })).toBe("Model profile: deep (complex models; reviewer never below standard)");
    expect(formatModelProfile({})).toBe("Model profile: none (each CLI uses its own default model)");
  });
});
