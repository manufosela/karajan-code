import { describe, expect, it } from "vitest";
import { calculateUsageCostUsd } from "../src/utils/pricing.js";

describe("calculateUsageCostUsd", () => {
  const mockPricing = {
    "claude-sonnet-4.6": { input_per_million: 3.0, output_per_million: 15.0 },
    "aider/claude-3-7-sonnet": { input_per_million: 3.0, output_per_million: 15.0 },
    "gpt-5.4-standard": { input_per_million: 2.5, output_per_million: 15.0 },
    "opencode/gpt-5.1-codex": { input_per_million: 2.5, output_per_million: 15.0 }
  };

  it("calculates cost for exact model match", () => {
    const cost = calculateUsageCostUsd({
      model: "claude-sonnet-4.6",
      tokens_in: 1_000_000,
      tokens_out: 1_000_000,
      pricing: mockPricing
    });
    expect(cost).toBe(18.0);
  });

  it("calculates cost using provider-prefixed match (e.g. aider/claude-3-7-sonnet)", () => {
    const cost = calculateUsageCostUsd({
      provider: "aider",
      model: "claude-3-7-sonnet",
      tokens_in: 1_000_000,
      tokens_out: 0,
      pricing: mockPricing
    });
    expect(cost).toBe(3.0);
  });

  it("calculates cost using prefix-stripped match (e.g. deepseek/deepseek-chat)", () => {
    const cost = calculateUsageCostUsd({
      model: "openai/gpt-5.4-standard", // Prefix is not in table, but bare model is
      tokens_in: 0,
      tokens_out: 1_000_000,
      pricing: mockPricing
    });
    expect(cost).toBe(15.0);
  });

  it("returns 0 when no match is found", () => {
    const cost = calculateUsageCostUsd({
      model: "unknown-model",
      tokens_in: 100,
      tokens_out: 100,
      pricing: mockPricing
    });
    expect(cost).toBe(0);
  });

  it("falls back gracefully when provider is omitted", () => {
    const cost = calculateUsageCostUsd({
      model: "opencode/gpt-5.1-codex",
      tokens_in: 1_000_000,
      tokens_out: 1_000_000,
      pricing: mockPricing
    });
    expect(cost).toBe(17.5);
  });
});
