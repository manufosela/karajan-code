import { describe, expect, it } from "vitest";
import { computeKjComparison, formatComparisonLine } from "../../src/budget/comparison.js";

describe("budget/comparison — computeKjComparison", () => {
  it("returns hasCompression:false when no savings data", () => {
    const cmp = computeKjComparison({ realTokens: 1000, realCost: 0.05 });
    expect(cmp.hasCompression).toBe(false);
    expect(cmp.withKj).toEqual({ tokens: 1000, cost: 0.05 });
    expect(cmp.withoutKj).toEqual({ tokens: 1000, cost: 0.05 });
    expect(cmp.savedTokens).toBe(0);
  });

  it("returns hasCompression:false when both savings sources are zero", () => {
    const cmp = computeKjComparison({
      realTokens: 1000,
      realCost: 0.05,
      rtkSavings: { estimatedTokensSaved: 0 },
      brainCtx: { compressionStats: { totalSaved: 0 } },
    });
    expect(cmp.hasCompression).toBe(false);
  });

  it("computes projection when RTK saved tokens", () => {
    const cmp = computeKjComparison({
      realTokens: 1000,
      realCost: 0.05,
      rtkSavings: { estimatedTokensSaved: 4000 },
    });
    expect(cmp.hasCompression).toBe(true);
    expect(cmp.withKj.tokens).toBe(1000);
    expect(cmp.withoutKj.tokens).toBe(5000);
    // cost projection: 0.05 * 5000/1000 = 0.25
    expect(cmp.withoutKj.cost).toBeCloseTo(0.25, 4);
    expect(cmp.savedTokens).toBe(4000);
    expect(cmp.savedPct).toBeCloseTo(80, 1);
    expect(cmp.breakdown).toEqual({ rtkTokens: 4000, brainTokens: 0 });
  });

  it("computes projection when Brain compression saved tokens", () => {
    const cmp = computeKjComparison({
      realTokens: 2000,
      realCost: 0.10,
      brainCtx: { compressionStats: { totalSaved: 3000 } },
    });
    expect(cmp.hasCompression).toBe(true);
    expect(cmp.withoutKj.tokens).toBe(5000);
    expect(cmp.withoutKj.cost).toBeCloseTo(0.25, 4);
    expect(cmp.breakdown).toEqual({ rtkTokens: 0, brainTokens: 3000 });
  });

  it("sums RTK + Brain savings", () => {
    const cmp = computeKjComparison({
      realTokens: 1000,
      realCost: 0.05,
      rtkSavings: { estimatedTokensSaved: 2000 },
      brainCtx: { compressionStats: { totalSaved: 2000 } },
    });
    expect(cmp.savedTokens).toBe(4000);
    expect(cmp.withoutKj.tokens).toBe(5000);
    expect(cmp.breakdown).toEqual({ rtkTokens: 2000, brainTokens: 2000 });
  });

  it("savedPct is computed against the without-KJ total", () => {
    const cmp = computeKjComparison({
      realTokens: 1000,
      realCost: 0.05,
      rtkSavings: { estimatedTokensSaved: 9000 },
    });
    // saved / (real + saved) = 9000 / 10000 = 90%
    expect(cmp.savedPct).toBeCloseTo(90, 1);
  });

  it("handles realTokens=0 gracefully (hasCompression:false to avoid div/0)", () => {
    const cmp = computeKjComparison({
      realTokens: 0,
      realCost: 0,
      rtkSavings: { estimatedTokensSaved: 1000 },
    });
    expect(cmp.hasCompression).toBe(false);
  });

  it("treats null/undefined args as zero", () => {
    const cmp = computeKjComparison({});
    expect(cmp.hasCompression).toBe(false);
    expect(cmp.withKj.tokens).toBe(0);
    expect(cmp.withKj.cost).toBe(0);
  });

  it("rejects negative inputs", () => {
    const cmp = computeKjComparison({ realTokens: -100, realCost: -0.05 });
    expect(cmp.withKj.tokens).toBe(0);
    expect(cmp.withKj.cost).toBe(0);
  });
});

describe("budget/comparison — formatComparisonLine", () => {
  it("returns null when hasCompression is false", () => {
    expect(formatComparisonLine({ hasCompression: false })).toBeNull();
    expect(formatComparisonLine(null)).toBeNull();
    expect(formatComparisonLine(undefined)).toBeNull();
  });

  it("renders a compact single-line comparison", () => {
    const cmp = {
      hasCompression: true,
      withKj: { tokens: 1287, cost: 0.06 },
      withoutKj: { tokens: 11324, cost: 1.30 },
      savedTokens: 10037,
      savedPct: 88.6,
      breakdown: { rtkTokens: 10037, brainTokens: 0 },
    };
    const line = formatComparisonLine(cmp);
    expect(line).toContain("With KJ: $0.06 / 1,287 tokens");
    expect(line).toContain("Without KJ: ~$1.30 / ~11,324 tokens");
    expect(line).toContain("(-89%)"); // rounded
  });

  it("formats large numbers with locale separators", () => {
    const cmp = {
      hasCompression: true,
      withKj: { tokens: 1000000, cost: 15 },
      withoutKj: { tokens: 5000000, cost: 75 },
      savedPct: 80,
      savedTokens: 4000000,
      breakdown: { rtkTokens: 4000000, brainTokens: 0 },
    };
    const line = formatComparisonLine(cmp);
    expect(line).toContain("1,000,000 tokens");
    expect(line).toContain("~5,000,000 tokens");
  });
});
