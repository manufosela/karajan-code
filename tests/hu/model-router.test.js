import { describe, it, expect } from "vitest";
import { recommendModelsForHu, complexityToLevel } from "../../src/hu/model-router.js";

// KJC-TSK-0405: dado un HU con complexity score, devuelve qué coder_model
// y reviewer_model usar. Cross-provider reviewer por defecto (claude→codex,
// codex→claude, gemini→claude).

describe("complexityToLevel", () => {
  it("score numérico → level discreto", () => {
    expect(complexityToLevel(1)).toBe("trivial");
    expect(complexityToLevel(2)).toBe("simple");
    expect(complexityToLevel(3)).toBe("medium");
    expect(complexityToLevel(5)).toBe("complex");
  });
  it("acepta string canónico tal cual", () => {
    expect(complexityToLevel("trivial")).toBe("trivial");
    expect(complexityToLevel("medium")).toBe("medium");
    expect(complexityToLevel("complex")).toBe("complex");
  });
  it("desconocido / null → medium (fallback conservador)", () => {
    expect(complexityToLevel(null)).toBe("medium");
    expect(complexityToLevel(undefined)).toBe("medium");
    expect(complexityToLevel("foobar")).toBe("medium");
    expect(complexityToLevel(99)).toBe("medium");
  });
});

describe("recommendModelsForHu", () => {
  const baseConfig = { roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } } };

  it("complexity=trivial + provider claude → coder haiku", () => {
    const r = recommendModelsForHu({ complexity: "trivial", coderProvider: "claude", config: baseConfig });
    expect(r.coder_model).toBe("haiku");
  });
  it("complexity=medium + provider claude → coder sonnet", () => {
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "claude", config: baseConfig });
    expect(r.coder_model).toBe("sonnet");
  });
  it("complexity=complex + provider claude → coder opus", () => {
    const r = recommendModelsForHu({ complexity: "complex", coderProvider: "claude", config: baseConfig });
    expect(r.coder_model).toBe("opus");
  });

  it("reviewer default es cross-provider del coder (claude→codex)", () => {
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "claude", config: baseConfig });
    expect(r.reviewer_provider).toBe("codex");
    expect(r.reviewer_model).toBeTruthy();
  });
  it("reviewer cross-provider de codex es claude", () => {
    const cfg = { roles: { coder: { provider: "codex" }, reviewer: { provider: "claude" } } };
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "codex", config: cfg });
    expect(r.reviewer_provider).toBe("claude");
  });
  it("reviewer cross-provider de gemini cae a claude", () => {
    const cfg = { roles: { coder: { provider: "gemini" } } };
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "gemini", config: cfg });
    expect(r.reviewer_provider).toBe("claude");
  });

  it("config.model_routing.fixed.coder es override total", () => {
    const cfg = {
      ...baseConfig,
      model_routing: { fixed: { coder: "claude-sonnet-4-6" } },
    };
    const r = recommendModelsForHu({ complexity: "trivial", coderProvider: "claude", config: cfg });
    expect(r.coder_model).toBe("claude-sonnet-4-6");
  });

  it("config.model_routing.fixed.reviewer es override total", () => {
    const cfg = {
      ...baseConfig,
      model_routing: { fixed: { reviewer: "opus" } },
    };
    const r = recommendModelsForHu({ complexity: "trivial", coderProvider: "claude", config: cfg });
    expect(r.reviewer_model).toBe("opus");
  });

  it("config.model_routing.by_provider override tiers default", () => {
    const cfg = {
      ...baseConfig,
      model_routing: {
        by_provider: {
          claude: { trivial: "haiku-custom", medium: "sonnet-custom", complex: "opus-custom" },
        },
      },
    };
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "claude", config: cfg });
    expect(r.coder_model).toBe("sonnet-custom");
  });

  it("provider desconocido → coder_model null pero no throws", () => {
    const r = recommendModelsForHu({ complexity: "medium", coderProvider: "unknownProvider", config: baseConfig });
    expect(r.coder_model).toBeNull();
  });
});
