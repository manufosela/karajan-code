// KJC-TSK-0473 — display helpers for audit-history diff + sparkline.
import { describe, expect, it } from "vitest";
import { computeHistoryDiff, formatHistoryDiff, formatTrendSparkline } from "../../src/audit/audit-history-display.js";

const currentHarness = {
  score: 74, grade: "B",
  categories: { architectural_docs: { score: 80 }, testing_stability: { score: 60 }, security: { score: 70 } },
};

function prevRow(overrides = {}) {
  return {
    score: 71, grade: "C",
    timestamp: "2026-05-20T10:00:00Z",
    categories_json: JSON.stringify({ architectural_docs: { score: 60 }, testing_stability: { score: 65 }, security: { score: 70 } }),
    ...overrides,
  };
}

describe("computeHistoryDiff — KJC-TSK-0473", () => {
  it("returns firstRun:true when previous row is missing", () => {
    expect(computeHistoryDiff(currentHarness, null)).toMatchObject({ firstRun: true, previousScore: null });
  });

  it("returns null when current harness has no score", () => {
    expect(computeHistoryDiff({ score: null }, prevRow())).toBeNull();
  });

  it("computes overall delta + per-category deltas", () => {
    const diff = computeHistoryDiff(currentHarness, prevRow());
    expect(diff.delta).toBe(3);
    expect(diff.previousScore).toBe(71);
    expect(diff.previousGrade).toBe("C");
    expect(diff.categoryDeltas.find((c) => c.name === "architectural_docs").delta).toBe(20);
    expect(diff.categoryDeltas.find((c) => c.name === "testing_stability").delta).toBe(-5);
  });

  it("highlights biggest improvement and regression", () => {
    const diff = computeHistoryDiff(currentHarness, prevRow());
    expect(diff.biggestImprovement.name).toBe("architectural_docs");
    expect(diff.biggestImprovement.delta).toBe(20);
    expect(diff.biggestRegression.name).toBe("testing_stability");
    expect(diff.biggestRegression.delta).toBe(-5);
  });

  it("flags baseline as stale when >30 days old", () => {
    const oldRow = prevRow({ timestamp: new Date(Date.now() - 32 * 86400000).toISOString() });
    const diff = computeHistoryDiff(currentHarness, oldRow);
    expect(diff.baselineStale).toBe(true);
    expect(diff.baselineAgeDays).toBeGreaterThanOrEqual(32);
  });
});

describe("formatHistoryDiff — KJC-TSK-0473", () => {
  it("renders first-run message", () => {
    expect(formatHistoryDiff({ firstRun: true })).toContain("First run");
  });

  it("renders delta + arrow + previous score", () => {
    const md = formatHistoryDiff(computeHistoryDiff(currentHarness, prevRow()));
    expect(md).toContain("Δ +3 ↑");
    expect(md).toContain("2026-05-20");
    expect(md).toContain("71/100");
    expect(md).toContain("Mayor mejora");
    expect(md).toContain("Mayor regresión");
  });

  it("includes stale-baseline warning", () => {
    const oldRow = prevRow({ timestamp: new Date(Date.now() - 60 * 86400000).toISOString() });
    const md = formatHistoryDiff(computeHistoryDiff(currentHarness, oldRow));
    expect(md).toContain("baseline antigua");
  });

  it("returns empty string for null diff", () => {
    expect(formatHistoryDiff(null)).toBe("");
  });
});

describe("formatTrendSparkline — KJC-TSK-0473", () => {
  it("renders unicode bars for a sequence of scores", () => {
    const out = formatTrendSparkline([{ score: 62 }, { score: 65 }, { score: 68 }, { score: 71 }, { score: 74 }]);
    expect(out).toMatch(/Score trend \(last 5 runs\): 62 .{5} 74/);
  });

  it("handles a single run gracefully", () => {
    expect(formatTrendSparkline([{ score: 80 }])).toContain("single run");
  });

  it("returns empty string when there are no scores", () => {
    expect(formatTrendSparkline([])).toBe("");
    expect(formatTrendSparkline(null)).toBe("");
  });
});
