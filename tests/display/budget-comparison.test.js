import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { printSessionBudget } from "../../src/utils/display/session-summary.js";
import { EVENT_HANDLERS } from "../../src/utils/display/event-handlers.js";

describe("display/budget-comparison — printSessionBudget", () => {
  let output;
  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("renders only plain budget when kj_comparison is absent", () => {
    printSessionBudget({ total_tokens: 1000, total_cost_usd: 0.05 });
    expect(output.some((l) => l.includes("Total cost: $0.05"))).toBe(true);
    expect(output.some((l) => l.includes("With KJ"))).toBe(false);
    expect(output.some((l) => l.includes("Without KJ"))).toBe(false);
  });

  it("renders comparison lines when kj_comparison.hasCompression is true", () => {
    printSessionBudget({
      total_tokens: 1287,
      total_cost_usd: 0.06,
      kj_comparison: {
        hasCompression: true,
        withKj: { tokens: 1287, cost: 0.06 },
        withoutKj: { tokens: 11324, cost: 1.30 },
        savedPct: 88.6,
        savedTokens: 10037,
      },
    });
    const all = output.join("\n");
    expect(all).toContain("With KJ: $0.06 / 1,287 tokens");
    expect(all).toContain("Without KJ: ~$1.30 / ~11,324 tokens");
    expect(all).toContain("-89%");
  });

  it("omits comparison when hasCompression is false", () => {
    printSessionBudget({
      total_tokens: 100,
      total_cost_usd: 0.01,
      kj_comparison: { hasCompression: false },
    });
    expect(output.join("\n")).not.toContain("Without KJ");
  });
});

describe("display/budget-comparison — budget:update event handler", () => {
  let output;
  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function invokeHandler(detail) {
    const handler = EVENT_HANDLERS["budget:update"];
    handler({ detail }, "\ud83d\udcb8");
  }

  it("prints just the budget line when no comparison is present", () => {
    invokeHandler({ total_cost_usd: 0.05, total_tokens: 1000 });
    expect(output.join("\n")).toContain("Budget:");
    expect(output.join("\n")).not.toContain("Without KJ");
  });

  it("prints a secondary 'Without KJ' line when comparison.hasCompression is true", () => {
    invokeHandler({
      total_cost_usd: 0.06,
      total_tokens: 1287,
      kj_comparison: {
        hasCompression: true,
        withKj: { tokens: 1287, cost: 0.06 },
        withoutKj: { tokens: 11324, cost: 1.30 },
        savedPct: 88.6,
      },
    });
    const all = output.join("\n");
    expect(all).toContain("Budget:");
    expect(all).toContain("Without KJ: ~$1.30 / ~11,324 tokens (-89%)");
  });

  it("skips budget display entirely when both tokens and cost are 0", () => {
    invokeHandler({ total_cost_usd: 0, total_tokens: 0 });
    expect(output).toHaveLength(0);
  });
});
