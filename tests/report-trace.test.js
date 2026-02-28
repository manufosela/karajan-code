import { describe, expect, it, vi } from "vitest";
import { BudgetTracker } from "../src/utils/budget.js";
import { formatDuration, convertCost, formatCost, printTraceTable } from "../src/commands/report.js";

describe("BudgetTracker trace()", () => {
  it("returns entries with stage_index and duration_ms", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "triage", provider: "codex", tokens_in: 100, tokens_out: 50, cost_usd: 0.1, duration_ms: 1200, stage_index: 0 });
    tracker.record({ role: "coder", provider: "codex", tokens_in: 5000, tokens_out: 2000, cost_usd: 1.5, duration_ms: 45000, stage_index: 1 });
    tracker.record({ role: "reviewer", provider: "claude", tokens_in: 3000, tokens_out: 800, cost_usd: 0.8, duration_ms: 12000, stage_index: 2 });

    const trace = tracker.trace();
    expect(trace).toHaveLength(3);
    expect(trace[0]).toEqual({
      index: 0,
      role: "triage",
      provider: "codex",
      model: "codex",
      timestamp: expect.any(String),
      duration_ms: 1200,
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.1
    });
    expect(trace[1].index).toBe(1);
    expect(trace[1].role).toBe("coder");
    expect(trace[1].duration_ms).toBe(45000);
    expect(trace[2].index).toBe(2);
    expect(trace[2].role).toBe("reviewer");
  });

  it("uses entry index as fallback when stage_index is not set", () => {
    const tracker = new BudgetTracker();
    tracker.record({ role: "coder", provider: "codex", tokens_in: 100, tokens_out: 50, cost_usd: 0.1 });
    tracker.record({ role: "reviewer", provider: "claude", tokens_in: 200, tokens_out: 100, cost_usd: 0.2 });

    const trace = tracker.trace();
    expect(trace[0].index).toBe(0);
    expect(trace[1].index).toBe(1);
    expect(trace[0].duration_ms).toBeNull();
  });

  it("returns empty array when no entries recorded", () => {
    const tracker = new BudgetTracker();
    expect(tracker.trace()).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(3500)).toBe("3.5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m5s");
  });

  it("returns dash for null/undefined", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(undefined)).toBe("-");
  });
});

describe("convertCost", () => {
  it("returns USD as-is", () => {
    expect(convertCost(1.5, "usd", 0.92)).toBe(1.5);
  });

  it("converts to EUR with exchange rate", () => {
    expect(convertCost(1.0, "eur", 0.92)).toBeCloseTo(0.92, 6);
  });
});

describe("formatCost", () => {
  it("formats USD with dollar sign", () => {
    expect(formatCost(1.5, "usd")).toBe("$1.5000");
  });

  it("formats EUR with euro sign", () => {
    expect(formatCost(0.92, "eur")).toBe("\u20AC0.9200");
  });
});

describe("printTraceTable", () => {
  it("prints table with headers, rows, and totals", () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const trace = [
      { index: 0, role: "coder", provider: "codex", model: "codex", timestamp: "2026-01-01T00:00:00Z", duration_ms: 30000, tokens_in: 1000, tokens_out: 500, cost_usd: 0.5 },
      { index: 1, role: "reviewer", provider: "claude", model: "claude", timestamp: "2026-01-01T00:01:00Z", duration_ms: 15000, tokens_in: 800, tokens_out: 200, cost_usd: 0.3 }
    ];

    printTraceTable(trace, { currency: "usd", exchangeRate: 0.92 });

    expect(logs[0]).toContain("#");
    expect(logs[0]).toContain("Stage");
    expect(logs[0]).toContain("Provider");
    expect(logs[0]).toContain("Duration");
    expect(logs[0]).toContain("Tokens In");
    expect(logs[0]).toContain("Cost USD");

    // Data rows
    expect(logs[2]).toContain("coder");
    expect(logs[2]).toContain("codex");
    expect(logs[2]).toContain("30.0s");
    expect(logs[3]).toContain("reviewer");
    expect(logs[3]).toContain("claude");
    expect(logs[3]).toContain("15.0s");

    // Total row
    const totalRow = logs[logs.length - 1];
    expect(totalRow).toContain("TOTAL");
    expect(totalRow).toContain("1800");
    expect(totalRow).toContain("700");
    expect(totalRow).toContain("$0.8000");

    console.log.mockRestore();
  });

  it("prints EUR costs when currency is eur", () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const trace = [
      { index: 0, role: "coder", provider: "codex", model: "codex", timestamp: "2026-01-01T00:00:00Z", duration_ms: 10000, tokens_in: 1000, tokens_out: 500, cost_usd: 1.0 }
    ];

    printTraceTable(trace, { currency: "eur", exchangeRate: 0.92 });

    expect(logs[0]).toContain("Cost EUR");

    const dataRow = logs[2];
    expect(dataRow).toContain("\u20AC0.9200");

    console.log.mockRestore();
  });

  it("handles empty trace", () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printTraceTable([], { currency: "usd", exchangeRate: 0.92 });
    expect(logs[0]).toContain("No trace data available");

    console.log.mockRestore();
  });
});
