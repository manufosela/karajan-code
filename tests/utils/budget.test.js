import { describe, expect, it } from "vitest";
import { extractUsageMetrics, estimateTokens, BudgetTracker } from "../../src/utils/budget.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    const result = estimateTokens(400, 800);
    expect(result.tokens_in).toBe(100);
    expect(result.tokens_out).toBe(200);
    expect(result.estimated).toBe(true);
  });

  it("handles zero lengths", () => {
    const result = estimateTokens(0, 0);
    expect(result.tokens_in).toBe(0);
    expect(result.tokens_out).toBe(0);
  });

  it("handles null/undefined lengths", () => {
    const result = estimateTokens(null, undefined);
    expect(result.tokens_in).toBe(0);
    expect(result.tokens_out).toBe(0);
  });
});

describe("extractUsageMetrics", () => {
  it("extracts real token data from result fields", () => {
    const result = { tokens_in: 1000, tokens_out: 2000, cost_usd: 0.05, model: "claude" };
    const metrics = extractUsageMetrics(result);
    expect(metrics.tokens_in).toBe(1000);
    expect(metrics.tokens_out).toBe(2000);
    expect(metrics.cost_usd).toBe(0.05);
    expect(metrics.model).toBe("claude");
    expect(metrics.estimated).toBe(false);
  });

  it("extracts from nested usage object", () => {
    const result = { usage: { input_tokens: 500, output_tokens: 800 } };
    const metrics = extractUsageMetrics(result, "sonnet");
    expect(metrics.tokens_in).toBe(500);
    expect(metrics.tokens_out).toBe(800);
    expect(metrics.model).toBe("sonnet");
  });

  it("estimates from promptSize when no real data is available", () => {
    const result = { promptSize: 4000, output: "a".repeat(800) };
    const metrics = extractUsageMetrics(result);
    expect(metrics.tokens_in).toBe(1000);
    expect(metrics.tokens_out).toBe(200);
    expect(metrics.estimated).toBe(true);
  });

  describe("fallback estimation from output text", () => {
    it("estimates from output text when no real data and no promptSize", () => {
      const result = { output: "a".repeat(2000) };
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(0);
      expect(metrics.tokens_out).toBe(500);
      expect(metrics.estimated).toBe(true);
    });

    it("estimates from error text when no real data", () => {
      const result = { error: "b".repeat(400) };
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(0);
      expect(metrics.tokens_out).toBe(100);
      expect(metrics.estimated).toBe(true);
    });

    it("estimates from summary text when no output or error", () => {
      const result = { summary: "c".repeat(1200) };
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(0);
      expect(metrics.tokens_out).toBe(300);
      expect(metrics.estimated).toBe(true);
    });

    it("does NOT estimate when there is no text at all", () => {
      const result = {};
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(0);
      expect(metrics.tokens_out).toBe(0);
      expect(metrics.estimated).toBe(false);
    });

    it("does NOT estimate when real tokens are available", () => {
      const result = { tokens_in: 100, tokens_out: 200, output: "a".repeat(10000) };
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(100);
      expect(metrics.tokens_out).toBe(200);
      expect(metrics.estimated).toBe(false);
    });

    it("does NOT estimate when explicit cost is available", () => {
      const result = { cost_usd: 0.10, output: "a".repeat(10000) };
      const metrics = extractUsageMetrics(result);
      expect(metrics.tokens_in).toBe(0);
      expect(metrics.tokens_out).toBe(0);
      expect(metrics.estimated).toBe(false);
    });

    it("prefers output over error for estimation", () => {
      const result = { output: "a".repeat(800), error: "b".repeat(400) };
      const metrics = extractUsageMetrics(result);
      // output is used because it's checked first in the || chain
      expect(metrics.tokens_out).toBe(200);
      expect(metrics.estimated).toBe(true);
    });
  });

  it("real agent data takes priority over estimation", () => {
    // Simulates a Claude result with real usage data
    const result = {
      tokens_in: 3000,
      tokens_out: 4000,
      cost_usd: 0.117,
      model: "claude-opus-4-6[1m]",
      output: "a".repeat(50000)  // large output that would give different estimate
    };
    const metrics = extractUsageMetrics(result);
    expect(metrics.tokens_in).toBe(3000);
    expect(metrics.tokens_out).toBe(4000);
    expect(metrics.cost_usd).toBe(0.117);
    expect(metrics.estimated).toBe(false);
  });
});

// Φ0-E — `cached_tokens` is the cross-provider normalized metric. The agent
// extractors (claude/codex/gemini/aider/opencode) already surface a top-level
// `result.cached_tokens`, but extractUsageMetrics also accepts the raw shapes
// from each provider (Anthropic `cache_read_input_tokens`, OpenAI
// `prompt_tokens_details.cached_tokens`, Gemini `cachedContentTokenCount`).
describe("extractUsageMetrics — cached_tokens (Φ0-E)", () => {
  it.each([
    ["top-level result.cached_tokens",        { tokens_in: 1, tokens_out: 1, cached_tokens: 1200 }, 1200],
    ["nested usage.cached_tokens",            { usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 800 } }, 800],
    ["Anthropic cache_read_input_tokens",     { usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 600 } }, 600],
    ["OpenAI prompt_tokens_details.cached",   { usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 400 } } }, 400],
    ["Gemini cachedContentTokenCount",        { usage: { input_tokens: 1, output_tokens: 1, cachedContentTokenCount: 250 } }, 250],
    ["missing → 0 (measured zero, not undefined)", { tokens_in: 1, tokens_out: 1 }, 0]
  ])("%s", (_n, result, expected) => {
    expect(extractUsageMetrics(result).cached_tokens).toBe(expected);
  });
});

describe("BudgetTracker — cached_tokens accumulation (Φ0-E)", () => {
  it("totals + summary surface cached_tokens across entries", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder",    provider: "claude", tokens_in: 1000, tokens_out: 200, cached_tokens: 700, cost_usd: 0.01 });
    tracker.record({ role: "reviewer", provider: "codex",  tokens_in: 500,  tokens_out: 100, cached_tokens: 300, cost_usd: 0.02 });

    expect(tracker.total().cached_tokens).toBe(1000);
    const s = tracker.summary();
    expect(s.total_cached_tokens).toBe(1000);
    expect(s.breakdown_by_role.coder.cached_tokens).toBe(700);
    expect(s.breakdown_by_role.reviewer.cached_tokens).toBe(300);
    expect(tracker.trace()[0].cached_tokens).toBe(700);
  });

  it("treats undefined cached_tokens as 0 (preserves unmeasured semantics)", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "claude", tokens_in: 100, tokens_out: 50 });
    expect(tracker.total().cached_tokens).toBe(0);
    expect(tracker.entries[0].cached_tokens).toBe(0);
  });
});

describe("BudgetTracker.cursor() + since() — per-HU isolation (Φ0-E)", () => {
  it("cursor()=0 on empty tracker, since(0) returns zeroed delta", () => {
    const tracker = new BudgetTracker();
    expect(tracker.cursor()).toBe(0);
    expect(tracker.since(0)).toEqual({ tokens_in: 0, tokens_out: 0, cached_tokens: 0, cost_usd: 0, count: 0 });
  });

  it("isolates per-HU deltas: cursor at HU2 start, since() returns only HU2 entries", () => {
    const tracker = new BudgetTracker();
    // HU1
    tracker.record({ role: "coder", provider: "claude", tokens_in: 100, tokens_out: 50, cached_tokens: 70, cost_usd: 0.01 });
    tracker.record({ role: "reviewer", provider: "codex", tokens_in: 80, tokens_out: 20, cached_tokens: 40, cost_usd: 0.02 });
    const hu2Start = tracker.cursor();
    expect(hu2Start).toBe(2);
    // HU2
    tracker.record({ role: "coder", provider: "claude", tokens_in: 200, tokens_out: 100, cached_tokens: 150, cost_usd: 0.03 });
    tracker.record({ role: "reviewer", provider: "codex", tokens_in: 60, tokens_out: 30, cached_tokens: 50, cost_usd: 0.04 });

    const delta = tracker.since(hu2Start);
    expect(delta).toEqual({ tokens_in: 260, tokens_out: 130, cached_tokens: 200, cost_usd: 0.07, count: 2 });
    // Global totals remain accumulated across both HUs.
    expect(tracker.total().cached_tokens).toBe(310);
  });

  it("clamps out-of-range cursor (>length) and rejects negatives", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "claude", tokens_in: 10, tokens_out: 5, cached_tokens: 3 });
    expect(tracker.since(99).count).toBe(0);
    expect(tracker.since(-1).count).toBe(1);
  });
});

describe("BudgetTracker with estimated data", () => {
  it("marks entries as estimated when estimation is used", () => {
    const tracker = new BudgetTracker();
    const metrics = extractUsageMetrics({ output: "a".repeat(400) });
    tracker.record({ role: "coder", provider: "claude", ...metrics });

    expect(tracker.entries[0].estimated).toBe(true);
    expect(tracker.summary().includes_estimates).toBe(true);
  });

  it("hasUsageData returns true when estimation provides tokens", () => {
    const tracker = new BudgetTracker();
    const metrics = extractUsageMetrics({ output: "a".repeat(400) });
    tracker.record({ role: "coder", provider: "claude", ...metrics });

    expect(tracker.hasUsageData()).toBe(true);
  });
});
