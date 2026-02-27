import { describe, expect, it } from "vitest";
import { BudgetTracker } from "../src/utils/budget.js";

describe("BudgetTracker", () => {
  it("records entries and computes totals", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", tokens_in: 100, tokens_out: 250, cost_usd: 0.42 });
    tracker.record({ role: "reviewer", provider: "claude", tokens_in: 40, tokens_out: 60, cost_usd: 0.18 });

    expect(tracker.total()).toEqual({
      tokens_in: 140,
      tokens_out: 310,
      cost_usd: 0.6
    });
  });

  it("treats missing metrics as zero", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex" });

    expect(tracker.total()).toEqual({
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0
    });
    expect(tracker.summary().entries).toHaveLength(1);
  });

  it("returns remaining budget and over-budget status", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", cost_usd: 1.25 });

    expect(tracker.remaining(2)).toBeCloseTo(0.75, 8);
    expect(tracker.isOverBudget(2)).toBe(false);
    expect(tracker.isOverBudget(1)).toBe(true);
    expect(tracker.isOverBudget(null)).toBe(false);
  });

  it("builds summary breakdown by role", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", tokens_in: 10, tokens_out: 20, cost_usd: 0.1 });
    tracker.record({ role: "coder", provider: "codex", tokens_in: 5, tokens_out: 5, cost_usd: 0.05 });
    tracker.record({ role: "reviewer", provider: "claude", tokens_in: 3, tokens_out: 7, cost_usd: 0.02 });

    const summary = tracker.summary();
    expect(summary.total_tokens).toBe(50);
    expect(summary.total_cost_usd).toBe(0.17);
    expect(summary.breakdown_by_role.coder.total_cost_usd).toBe(0.15);
    expect(summary.breakdown_by_role.coder.tokens_in).toBe(15);
    expect(summary.breakdown_by_role.reviewer.tokens_out).toBe(7);
  });

  it("calculates cost from model pricing when cost_usd is missing", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", model: "codex/o4-mini", tokens_in: 2000000, tokens_out: 1000000 });

    expect(tracker.total()).toEqual({
      tokens_in: 2000000,
      tokens_out: 1000000,
      cost_usd: 7
    });
  });

  it("prefers explicit cost_usd over calculated pricing", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", model: "codex/o4-mini", tokens_in: 2000000, tokens_out: 1000000, cost_usd: 0.99 });

    expect(tracker.total().cost_usd).toBe(0.99);
  });

  it("supports pricing overrides through constructor options", () => {
    const tracker = new BudgetTracker({ pricing: { "codex/o4-mini": { input_per_million: 2, output_per_million: 3 } } });
    tracker.record({ role: "coder", provider: "codex", model: "codex/o4-mini", tokens_in: 500000, tokens_out: 500000 });

    expect(tracker.total().cost_usd).toBe(2.5);
  });
});
