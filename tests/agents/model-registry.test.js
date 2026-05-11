import { describe, expect, it } from "vitest";
import {
  registerModel,
  registerModelAlias,
  getModelPricing,
  isModelDeprecated,
  getModelInfo,
  getRegisteredModels,
  buildDefaultPricingTable,
} from "../src/agents/model-registry.js";

describe("model-registry", () => {
  describe("built-in models", () => {
    it("registers the core CLI models", () => {
      const models = getRegisteredModels();
      expect(models.length).toBeGreaterThanOrEqual(12);
    });

    it("returns pricing for sonnet", () => {
      const pricing = getModelPricing("sonnet");
      expect(pricing).toEqual({ input_per_million: 3, output_per_million: 15 });
    });

    it("returns pricing for o4-mini", () => {
      const pricing = getModelPricing("o4-mini");
      expect(pricing).toEqual({ input_per_million: 1.5, output_per_million: 4 });
    });

    it("returns pricing for gemini-2.0-flash", () => {
      const pricing = getModelPricing("gemini-2.0-flash");
      expect(pricing).toEqual({ input_per_million: 0.075, output_per_million: 0.3 });
    });

    it("returns null for unknown model", () => {
      expect(getModelPricing("gpt5")).toBeNull();
    });
  });

  describe("registerModel", () => {
    it("registers a new model and retrieves its pricing", () => {
      registerModel("test/custom-model", {
        provider: "test-provider",
        pricing: { input_per_million: 2, output_per_million: 8 },
      });
      expect(getModelPricing("test/custom-model")).toEqual({
        input_per_million: 2,
        output_per_million: 8,
      });
    });

    it("throws for empty model name", () => {
      expect(() => registerModel("", { pricing: { input_per_million: 1, output_per_million: 1 } }))
        .toThrow("Model name must be a non-empty string");
    });

    it("throws when pricing is missing", () => {
      expect(() => registerModel("test/no-pricing", {}))
        .toThrow('requires pricing');
    });

    it("infers provider from model name when not specified", () => {
      registerModel("newprovider/v1", {
        pricing: { input_per_million: 1, output_per_million: 2 },
      });
      const info = getModelInfo("newprovider/v1");
      expect(info.provider).toBe("newprovider");
    });
  });

  describe("registerModelAlias", () => {
    it("registers an alias to an existing model", () => {
      registerModel("target-model", {
        provider: "test",
        pricing: { input_per_million: 1, output_per_million: 1 }
      });
      registerModelAlias("alias-model", "target-model");
      expect(getModelPricing("alias-model")).toEqual({ input_per_million: 1, output_per_million: 1 });
      expect(getModelInfo("alias-model").provider).toBe("test");
    });

    it("throws when target model is not found", () => {
      expect(() => registerModelAlias("alias-fail", "non-existent"))
        .toThrow('Target model "non-existent" for alias "alias-fail" not found');
    });
  });

  describe("isModelDeprecated", () => {
    it("returns false for non-deprecated models", () => {
      expect(isModelDeprecated("claude")).toBe(false);
    });

    it("returns false for unknown models", () => {
      expect(isModelDeprecated("nonexistent")).toBe(false);
    });

    it("returns true for a model with past deprecation date", () => {
      registerModel("test/old-model", {
        provider: "test",
        pricing: { input_per_million: 1, output_per_million: 1 },
        deprecated: "2020-01-01",
      });
      expect(isModelDeprecated("test/old-model")).toBe(true);
    });

    it("returns false for a model with future deprecation date", () => {
      registerModel("test/future-model", {
        provider: "test",
        pricing: { input_per_million: 1, output_per_million: 1 },
        deprecated: "2099-12-31",
      });
      expect(isModelDeprecated("test/future-model")).toBe(false);
    });
  });

  describe("getModelInfo", () => {
    it("returns full info for a registered model", () => {
      const info = getModelInfo("opus");
      expect(info).toEqual({
        name: "opus",
        provider: "anthropic",
        pricing: { input_per_million: 15, output_per_million: 75 },
        deprecated: null,
      });
    });

    it("returns null for unknown model", () => {
      expect(getModelInfo("unknown")).toBeNull();
    });
  });

  describe("buildDefaultPricingTable", () => {
    it("returns a plain object with all registered models", () => {
      const table = buildDefaultPricingTable();
      expect(table["claude"]).toEqual({ input_per_million: 3, output_per_million: 15 });
      expect(table["o3"]).toEqual({ input_per_million: 10, output_per_million: 40 });
      expect(table["gemini-2.0-flash"]).toEqual({ input_per_million: 0.075, output_per_million: 0.3 });
    });

    it("returns defensive copies (mutations do not affect registry)", () => {
      const table = buildDefaultPricingTable();
      table["claude"].input_per_million = 999;
      const fresh = buildDefaultPricingTable();
      expect(fresh["claude"].input_per_million).toBe(3);
    });
  });
});
