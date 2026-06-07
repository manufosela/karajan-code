import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  getModelPricing,
  listKnownModels,
  _resetCache,
} from "../../src/pricing/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, "../../src/pricing/model-pricing.json");

describe("pricing — model-pricing.json structure", () => {
  it("is valid JSON with a _meta block", () => {
    const raw = readFileSync(REGISTRY_PATH, "utf8");
    const data = JSON.parse(raw);
    expect(data._meta).toBeDefined();
    expect(data._meta.currency).toBe("USD");
    expect(data._meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data._meta.unit).toMatch(/1M tokens/);
  });

  it("every entry (except _meta) has inputPerMTok, outputPerMTok and source", () => {
    const raw = readFileSync(REGISTRY_PATH, "utf8");
    const data = JSON.parse(raw);
    for (const [key, entry] of Object.entries(data)) {
      if (key.startsWith("_")) continue;
      expect(typeof entry.inputPerMTok).toBe("number");
      expect(typeof entry.outputPerMTok).toBe("number");
      expect(entry.inputPerMTok).toBeGreaterThanOrEqual(0);
      expect(entry.outputPerMTok).toBeGreaterThanOrEqual(0);
      expect(typeof entry.source).toBe("string");
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });
});

describe("pricing — getModelPricing()", () => {
  beforeEach(() => _resetCache());

  it("returns full pricing for a known Anthropic model", () => {
    const p = getModelPricing("claude-opus-4-7");
    expect(p).not.toBeNull();
    expect(p.inputPerMTok).toBe(15.0);
    expect(p.outputPerMTok).toBe(75.0);
    expect(p.currency).toBe("USD");
    expect(p.source).toBe("anthropic");
    expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns full pricing for an OpenAI model", () => {
    const p = getModelPricing("gpt-4o");
    expect(p).not.toBeNull();
    expect(p.source).toBe("openai");
    expect(p.inputPerMTok).toBeGreaterThan(0);
  });

  it("returns full pricing for a Google model", () => {
    const p = getModelPricing("gemini-1.5-flash");
    expect(p).not.toBeNull();
    expect(p.source).toBe("google");
  });

  it("returns null for an unknown model", () => {
    expect(getModelPricing("nonexistent-model-xyz")).toBeNull();
  });

  it("returns null for the _meta key (does not leak metadata)", () => {
    expect(getModelPricing("_meta")).toBeNull();
  });

  it("returns null for empty / non-string inputs", () => {
    expect(getModelPricing("")).toBeNull();
    expect(getModelPricing(null)).toBeNull();
    expect(getModelPricing(undefined)).toBeNull();
    expect(getModelPricing(42)).toBeNull();
  });
});

describe("pricing — listKnownModels()", () => {
  it("returns a non-empty list and never includes _meta", () => {
    const models = listKnownModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(5);
    expect(models).not.toContain("_meta");
  });

  it("every listed model resolves via getModelPricing", () => {
    for (const m of listKnownModels()) {
      expect(getModelPricing(m)).not.toBeNull();
    }
  });
});
