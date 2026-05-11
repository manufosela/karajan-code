import { describe, expect, it } from "vitest";
import {
  getDefaultModelTiers,
  getDefaultRoleOverrides,
  resolveModelForRole,
  selectModelsForRoles
} from "../src/utils/model-selector.js";

describe("getDefaultModelTiers", () => {
  it("returns a deep copy (not the same reference)", () => {
    const a = getDefaultModelTiers();
    const b = getDefaultModelTiers();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.claude.trivial = "mutated";
    expect(getDefaultModelTiers().claude.trivial).toBe("haiku");
  });

  it("includes all four providers", () => {
    const tiers = getDefaultModelTiers();
    expect(Object.keys(tiers).sort()).toEqual(["aider", "claude", "codex", "gemini"]);
  });

  it("each provider has all four levels", () => {
    const tiers = getDefaultModelTiers();
    for (const provider of Object.keys(tiers)) {
      expect(Object.keys(tiers[provider]).sort()).toEqual(["complex", "medium", "simple", "trivial"]);
    }
  });

  it("aider has null for all levels", () => {
    const tiers = getDefaultModelTiers();
    for (const level of ["trivial", "simple", "medium", "complex"]) {
      expect(tiers.aider[level]).toBeNull();
    }
  });
});

describe("getDefaultRoleOverrides", () => {
  it("returns a deep copy", () => {
    const a = getDefaultRoleOverrides();
    const b = getDefaultRoleOverrides();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("reviewer maps trivial and simple to medium", () => {
    const ovr = getDefaultRoleOverrides();
    expect(ovr.reviewer.trivial).toBe("medium");
    expect(ovr.reviewer.simple).toBe("medium");
  });

  it("triage maps medium and complex to simple", () => {
    const ovr = getDefaultRoleOverrides();
    expect(ovr.triage.medium).toBe("simple");
    expect(ovr.triage.complex).toBe("simple");
  });
});

describe("resolveModelForRole", () => {
  it("maps claude/simple → haiku", () => {
    expect(resolveModelForRole({ role: "coder", provider: "claude", level: "simple" })).toBe("haiku");
  });

  it("maps claude/complex → opus", () => {
    expect(resolveModelForRole({ role: "coder", provider: "claude", level: "complex" })).toBe("opus");
  });

  it("maps codex/trivial → o4-mini", () => {
    expect(resolveModelForRole({ role: "coder", provider: "codex", level: "trivial" })).toBe("o4-mini");
  });

  it("maps codex/complex → o3", () => {
    expect(resolveModelForRole({ role: "coder", provider: "codex", level: "complex" })).toBe("o3");
  });

  it("maps gemini/trivial → gemini-2.0-flash", () => {
    expect(resolveModelForRole({ role: "coder", provider: "gemini", level: "trivial" })).toBe("gemini-2.0-flash");
  });

  it("maps gemini/complex → gemini-2.5-pro", () => {
    expect(resolveModelForRole({ role: "coder", provider: "gemini", level: "complex" })).toBe("gemini-2.5-pro");
  });

  it("returns null for aider (no sub-models)", () => {
    expect(resolveModelForRole({ role: "coder", provider: "aider", level: "complex" })).toBeNull();
  });

  it("returns null for unknown provider", () => {
    expect(resolveModelForRole({ role: "coder", provider: "unknown", level: "simple" })).toBeNull();
  });

  it("returns null for invalid level", () => {
    expect(resolveModelForRole({ role: "coder", provider: "claude", level: "extreme" })).toBeNull();
  });

  it("returns null when provider is null", () => {
    expect(resolveModelForRole({ role: "coder", provider: null, level: "simple" })).toBeNull();
  });

  it("returns null when level is null", () => {
    expect(resolveModelForRole({ role: "coder", provider: "claude", level: null })).toBeNull();
  });

  it("applies reviewer role override: trivial → medium tier", () => {
    const result = resolveModelForRole({ role: "reviewer", provider: "claude", level: "trivial" });
    expect(result).toBe("sonnet");
  });

  it("applies reviewer role override: simple → medium tier", () => {
    const result = resolveModelForRole({ role: "reviewer", provider: "codex", level: "simple" });
    expect(result).toBe("o4-mini");
  });

  it("applies triage role override: complex → simple tier", () => {
    const result = resolveModelForRole({ role: "triage", provider: "claude", level: "complex" });
    expect(result).toBe("haiku");
  });

  it("applies triage role override: medium → simple tier", () => {
    const result = resolveModelForRole({ role: "triage", provider: "gemini", level: "medium" });
    expect(result).toBe("gemini-2.0-flash");
  });

  it("uses custom tierMap when provided", () => {
    const customTiers = { custom: { simple: "custom/fast", complex: "custom/heavy", trivial: null, medium: null } };
    expect(resolveModelForRole({ role: "coder", provider: "custom", level: "simple", tierMap: customTiers })).toBe("custom/fast");
  });

  it("uses custom roleOverrides when provided", () => {
    const customOverrides = { coder: { trivial: "complex" } };
    const result = resolveModelForRole({ role: "coder", provider: "claude", level: "trivial", roleOverrides: customOverrides });
    expect(result).toBe("opus");
  });
});

describe("selectModelsForRoles", () => {
  const baseConfig = {
    roles: {
      coder: { provider: "claude", model: null },
      reviewer: { provider: "codex", model: null },
      triage: { provider: "claude", model: null }
    },
    model_selection: { tiers: {}, role_overrides: {} }
  };

  it("selects models for all roles based on level", () => {
    const { modelOverrides } = selectModelsForRoles({ level: "simple", config: baseConfig });
    expect(modelOverrides.coder).toBe("haiku");
    expect(modelOverrides.reviewer).toBe("o4-mini");
    expect(modelOverrides.triage).toBe("haiku");
  });

  it("selects complex models for complex level", () => {
    const { modelOverrides } = selectModelsForRoles({ level: "complex", config: baseConfig });
    expect(modelOverrides.coder).toBe("opus");
    expect(modelOverrides.reviewer).toBe("o3");
    expect(modelOverrides.triage).toBe("haiku");
  });

  it("skips roles with explicit model set", () => {
    const config = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        coder: { provider: "claude", model: "opus" }
      }
    };
    const { modelOverrides } = selectModelsForRoles({ level: "trivial", config });
    expect(modelOverrides.coder).toBeUndefined();
    expect(modelOverrides.reviewer).toBeDefined();
  });

  it("skips disabled roles", () => {
    const config = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        coder: { provider: "claude", model: null, disabled: true }
      }
    };
    const { modelOverrides } = selectModelsForRoles({ level: "simple", config });
    expect(modelOverrides.coder).toBeUndefined();
  });

  it("skips roles without provider", () => {
    const config = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        coder: { provider: null, model: null }
      }
    };
    const { modelOverrides } = selectModelsForRoles({ level: "simple", config });
    expect(modelOverrides.coder).toBeUndefined();
  });

  it("returns empty overrides for invalid level", () => {
    const { modelOverrides, reasoning } = selectModelsForRoles({ level: "extreme", config: baseConfig });
    expect(modelOverrides).toEqual({});
    expect(reasoning).toContain("No valid triage level");
  });

  it("returns empty overrides for null level", () => {
    const { modelOverrides } = selectModelsForRoles({ level: null, config: baseConfig });
    expect(modelOverrides).toEqual({});
  });

  it("merges user tier overrides", () => {
    const config = {
      ...baseConfig,
      model_selection: {
        tiers: { claude: { simple: "sonnet" } },
        role_overrides: {}
      }
    };
    const { modelOverrides } = selectModelsForRoles({ level: "simple", config });
    expect(modelOverrides.coder).toBe("sonnet");
  });

  it("only selects for specified roles when roles param provided", () => {
    const { modelOverrides } = selectModelsForRoles({ level: "simple", config: baseConfig, roles: ["coder"] });
    expect(modelOverrides.coder).toBe("haiku");
    expect(modelOverrides.reviewer).toBeUndefined();
  });

  it("includes reasoning string", () => {
    const { reasoning } = selectModelsForRoles({ level: "simple", config: baseConfig });
    expect(reasoning).toContain("Smart model selection");
    expect(reasoning).toContain("level=simple");
  });
});
