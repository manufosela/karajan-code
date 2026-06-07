import { describe, it, expect } from "vitest";
import { aggregateRunCost } from "../../src/cost/index.js";

describe("aggregateRunCost — happy path", () => {
  it("aggregates a single-role single-model run", () => {
    const r = aggregateRunCost({
      events: [
        { role: "coder", model: "claude-opus-4-7", tokensIn: 1_000_000, tokensOut: 100_000 },
      ],
    });
    // 1M * $15 + 0.1M * $75 = 15 + 7.5
    expect(r.totalUsd).toBe(22.5);
    expect(r.byRole).toEqual({ coder: 22.5 });
    expect(r.byModel).toEqual({ "claude-opus-4-7": 22.5 });
    expect(r.hasUnknown).toBe(false);
    expect(r.currency).toBe("USD");
  });

  it("splits cost by role across multiple models and accumulates same-key events", () => {
    const r = aggregateRunCost({
      events: [
        { role: "coder", model: "claude-opus-4-7", tokensIn: 200_000, tokensOut: 50_000 },
        { role: "coder", model: "claude-opus-4-7", tokensIn: 100_000, tokensOut: 0 },
        { role: "reviewer", model: "gpt-4o", tokensIn: 100_000, tokensOut: 20_000 },
      ],
    });
    // coder: (0.2*15 + 0.05*75) + (0.1*15) = 6.75 + 1.5 = 8.25
    // reviewer: 0.1*2.5 + 0.02*10 = 0.45
    expect(r.byRole.coder).toBe(8.25);
    expect(r.byRole.reviewer).toBe(0.45);
    expect(r.totalUsd).toBe(8.7);
    expect(Object.keys(r.byModel).sort()).toEqual(["claude-opus-4-7", "gpt-4o"]);
  });
});

describe("aggregateRunCost — unknown models", () => {
  it("routes unknown tokens to unknownModelTokens, sorts + dedupes, calls logger", () => {
    const calls = [];
    const r = aggregateRunCost({
      events: [
        { role: "coder", model: "zzz-llm", tokensIn: 500, tokensOut: 200 },
        { role: "coder", model: "aaa-llm", tokensIn: 100, tokensOut: 100 },
        { role: "coder", model: "zzz-llm", tokensIn: 1, tokensOut: 1 },
        { role: "reviewer", model: "claude-opus-4-7", tokensIn: 100_000, tokensOut: 10_000 },
      ],
      logger: (level, msg, ctx) => calls.push({ level, ctx }),
    });
    expect(r.hasUnknown).toBe(true);
    expect(r.unknownModelTokens.tokensIn).toBe(601);
    expect(r.unknownModelTokens.tokensOut).toBe(301);
    expect(r.unknownModelTokens.models).toEqual(["aaa-llm", "zzz-llm"]);
    expect(r.byRole.coder).toBeUndefined();
    expect(r.byRole.reviewer).toBeGreaterThan(0);
    expect(calls.length).toBe(3);
    expect(calls[0].level).toBe("warn");
  });
});

describe("aggregateRunCost — edge cases", () => {
  it("returns zero for empty / missing events", () => {
    expect(aggregateRunCost({ events: [] }).totalUsd).toBe(0);
    expect(aggregateRunCost({}).totalUsd).toBe(0);
  });

  it("skips events with zero tokens and coerces invalid fields", () => {
    const r = aggregateRunCost({
      events: [
        { role: "coder", model: "claude-opus-4-7", tokensIn: 0, tokensOut: 0 },
        { role: "coder", model: "claude-opus-4-7", tokensIn: NaN, tokensOut: 10_000 },
        { role: "", model: "gpt-4o", tokensIn: 10_000, tokensOut: 1_000 },
        null,
        "not-an-object",
      ],
    });
    // First skipped, second: tokensIn=0, 10k output * 75 = 0.75
    expect(r.byRole.coder).toBe(0.75);
    expect(r.byRole.unknown).toBeGreaterThan(0);
  });

  it("rounds to 4 decimals", () => {
    const r = aggregateRunCost({
      events: [{ role: "coder", model: "gemini-1.5-flash", tokensIn: 100_000, tokensOut: 100_000 }],
    });
    // 0.1*0.075 + 0.1*0.30 = 0.0075 + 0.03 = 0.0375
    expect(r.totalUsd).toBe(0.0375);
    const frac = String(r.totalUsd).split(".")[1] || "";
    expect(frac.length).toBeLessThanOrEqual(4);
  });
});
