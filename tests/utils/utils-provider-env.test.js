import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PROVIDER_ENV,
  hasEnvVar,
  collectActiveProviders,
  getRequiredProviderEnvs,
  normalizeProvider,
} from "../../src/utils/provider-env.js";

describe("utils/provider-env", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  });

  describe("normalizeProvider", () => {
    it("maps CLI names to canonical provider slugs", () => {
      expect(normalizeProvider("claude")).toBe("anthropic");
      expect(normalizeProvider("codex")).toBe("openai");
      expect(normalizeProvider("gemini")).toBe("google");
      expect(normalizeProvider("opencode")).toBe("opencode");
      expect(normalizeProvider("aider")).toBe("aider");
    });

    it("returns canonical names untouched", () => {
      expect(normalizeProvider("anthropic")).toBe("anthropic");
      expect(normalizeProvider("openai")).toBe("openai");
      expect(normalizeProvider("google")).toBe("google");
    });

    it("handles empty/null input", () => {
      expect(normalizeProvider(null)).toBe("");
      expect(normalizeProvider(undefined)).toBe("");
      expect(normalizeProvider("")).toBe("");
    });
  });

  describe("hasEnvVar", () => {
    it("returns true when any listed env var is non-empty", () => {
      process.env.OPENAI_API_KEY = "sk-xxx";
      expect(hasEnvVar(PROVIDER_ENV.openai)).toBe(true);
    });

    it("returns true when any of multiple fallback names is set", () => {
      process.env.GOOGLE_API_KEY = "xxx";
      expect(hasEnvVar(PROVIDER_ENV.google)).toBe(true);
    });

    it("returns false for missing", () => {
      expect(hasEnvVar(PROVIDER_ENV.anthropic)).toBe(false);
    });

    it("returns false for whitespace-only value", () => {
      process.env.ANTHROPIC_API_KEY = "   ";
      expect(hasEnvVar(PROVIDER_ENV.anthropic)).toBe(false);
    });
  });

  describe("collectActiveProviders", () => {
    it("pulls providers from roles", () => {
      const config = {
        roles: {
          coder: { provider: "anthropic" },
          reviewer: { provider: "openai" },
          planner: { provider: null },
        },
      };
      const active = collectActiveProviders(config);
      expect(active.has("anthropic")).toBe(true);
      expect(active.has("openai")).toBe(true);
      expect(active.size).toBe(2);
    });

    it("also includes top-level coder/reviewer", () => {
      const config = { coder: "claude", reviewer: "codex", roles: {} };
      const active = collectActiveProviders(config);
      expect(active.has("claude")).toBe(true);
      expect(active.has("codex")).toBe(true);
    });

    it("handles missing config gracefully", () => {
      expect(collectActiveProviders({}).size).toBe(0);
      expect(collectActiveProviders(null).size).toBe(0);
    });
  });

  describe("getRequiredProviderEnvs", () => {
    it("returns entries for each active provider", () => {
      const config = {
        roles: {
          coder: { provider: "claude" },
          reviewer: { provider: "gemini" },
        },
      };
      const required = getRequiredProviderEnvs(config);
      const slugs = required.map((r) => r.provider);
      expect(slugs).toContain("anthropic");
      expect(slugs).toContain("google");
    });

    it("skips unknown providers", () => {
      const config = { roles: { coder: { provider: "unknown-model" } } };
      expect(getRequiredProviderEnvs(config)).toHaveLength(0);
    });
  });
});
