import { describe, it, expect } from "vitest";
import { formatHHMM, shortTask, formatSessionLabel, formatCost, formatProjectCostSummary, formatCacheRatio } from "../src/format.js";

describe("formatHHMM", () => {
  it("formats an ISO timestamp as HH:MM (24h, server-local)", () => {
    // The board runs on the server side; the user reads the same
    // timezone the server is in. We don't need to assert a fixed
    // string — but we can assert the shape.
    expect(formatHHMM("2026-05-07T08:35:58.010Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns a dash placeholder when the timestamp is missing", () => {
    expect(formatHHMM(null)).toBe("—");
    expect(formatHHMM(undefined)).toBe("—");
    expect(formatHHMM("")).toBe("—");
  });

  it("returns a dash placeholder when the timestamp is unparseable", () => {
    expect(formatHHMM("not a date")).toBe("—");
    expect(formatHHMM("2099-99-99T99:99:99Z")).toBe("—");
  });
});

describe("shortTask", () => {
  it("returns empty string for empty / null input", () => {
    expect(shortTask(null)).toBe("");
    expect(shortTask(undefined)).toBe("");
    expect(shortTask("")).toBe("");
  });

  it("collapses internal whitespace", () => {
    expect(shortTask("Add   a\nJSDoc\tcomment")).toBe("Add a JSDoc comment");
  });

  it("returns the full text when shorter than the limit", () => {
    expect(shortTask("Short task")).toBe("Short task");
  });

  it("truncates at max chars with an ellipsis suffix", () => {
    const long = "A".repeat(120);
    const out = shortTask(long, 30);
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects the configured max", () => {
    expect(shortTask("hello world", 5)).toBe("hell…");
  });
});

describe("formatSessionLabel", () => {
  it("falls back to '(no session)' when input is malformed", () => {
    expect(formatSessionLabel(null)).toEqual({
      title: "(no session)", subtitle: "", idChip: "",
    });
    expect(formatSessionLabel({})).toEqual({
      title: "(no session)", subtitle: "", idChip: "",
    });
  });

  it("uses project_name + HH:MM when both are available", () => {
    const r = formatSessionLabel({
      id: "s_2026-05-07T08-35-58-010Z",
      project_name: "tmp_kj-test-4",
      task: "Add a JSDoc comment to index.js",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.title).toMatch(/^tmp_kj-test-4 · \d{2}:\d{2}$/);
    expect(r.subtitle).toBe("Add a JSDoc comment to index.js");
    expect(r.idChip).toBe("s_2026-05-07T08-35-58-010Z");
  });

  it("falls back to session.id as title when no project is joined", () => {
    const r = formatSessionLabel({
      id: "s_orphan_xyz",
      project_name: null,
      task: "do stuff",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.title).toMatch(/^s_orphan_xyz · \d{2}:\d{2}$/);
    expect(r.subtitle).toBe("do stuff");
  });

  it("truncates an oversized project_name", () => {
    const longName = "a".repeat(80);
    const r = formatSessionLabel({
      id: "s1",
      project_name: longName,
      task: "x",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    // Pre-time-suffix part length === MAX_PROJECT_CHARS (40 chars + "…")
    const beforeDot = r.title.split(" · ")[0];
    expect(beforeDot.length).toBeLessThanOrEqual(40);
    expect(beforeDot.endsWith("…")).toBe(true);
  });

  it("renders a title without time when created_at is missing", () => {
    const r = formatSessionLabel({
      id: "s1",
      project_name: "myproj",
      task: "thing",
      created_at: null,
    });
    expect(r.title).toBe("myproj");
  });

  it("subtitle is empty when no task is recorded", () => {
    const r = formatSessionLabel({
      id: "s1",
      project_name: "p",
      task: null,
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.subtitle).toBe("");
  });

  it("idChip always preserves the raw session id (kj resume needs it)", () => {
    const id = "s_2026-05-07T08-35-58-010Z";
    expect(formatSessionLabel({ id, project_name: "p", task: "t", created_at: "2026-05-07T08:35:00Z" }).idChip).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// formatCost — Cost F (KJC-TSK-0517)
//
// The HU card shows two precisions for the same cost: a compact "$X.XX"
// label and a 4-decimal tooltip. The helper returns both atomically so
// the rendering code can't accidentally show one without the other.
// Null/undefined/NaN must return null so the badge is hidden — rendering
// "$0.00" for an unmeasured HU would be misleading.
// ---------------------------------------------------------------------------
describe("formatCost", () => {
  it("returns 2-decimal label and 4-decimal tooltip for a valid cost", () => {
    expect(formatCost(0.0234)).toEqual({
      label: "$0.02",
      tooltip: "Estimated cost: $0.0234",
    });
  });

  it("rounds the visible label but keeps full precision in tooltip", () => {
    expect(formatCost(1.2356)).toEqual({
      label: "$1.24",
      tooltip: "Estimated cost: $1.2356",
    });
  });

  it("returns null when cost is null (no badge → no false $0.00)", () => {
    expect(formatCost(null)).toBeNull();
  });

  it("returns null when cost is undefined", () => {
    expect(formatCost(undefined)).toBeNull();
  });

  it("returns null for NaN / Infinity", () => {
    expect(formatCost(NaN)).toBeNull();
    expect(formatCost(Infinity)).toBeNull();
    expect(formatCost(-Infinity)).toBeNull();
  });

  it("renders $0.00 / $0.0000 only when cost is genuinely 0 (free run)", () => {
    expect(formatCost(0)).toEqual({
      label: "$0.00",
      tooltip: "Estimated cost: $0.0000",
    });
  });

  it("accepts numeric strings (SQLite REAL → JS sometimes ships as string)", () => {
    expect(formatCost("0.5")).toEqual({
      label: "$0.50",
      tooltip: "Estimated cost: $0.5000",
    });
  });
});

// ---------------------------------------------------------------------------
// formatProjectCostSummary — Cost G (KJC-TSK-0518)
//
// Consumes the shape returned by GET /api/projects/:id/cost (Cost E):
//   { totalUsd, byPlan: [...], unknownModelTokens: {...}, currency }
// Returns null when there's nothing to show (no input, or 0 total with no
// plans). Same "no $0.00 for unmeasured" design as formatCost — rendering
// a misleading zero is worse than hiding the chip.
// ---------------------------------------------------------------------------
describe("formatProjectCostSummary", () => {
  it("returns label + multi-line tooltip with byPlan breakdown", () => {
    const out = formatProjectCostSummary({
      totalUsd: 1.5432,
      byPlan: [
        { planId: "plan-alpha", totalUsd: 1.0, huCount: 3 },
        { planId: "plan-beta", totalUsd: 0.5432, huCount: 1 },
      ],
    });
    expect(out.label).toBe("Total: $1.54");
    expect(out.tooltip).toBe(
      [
        "Total: $1.5432",
        "By plan:",
        "  plan-alpha: $1.00 (3 HUs)",
        "  plan-beta: $0.54 (1 HU)",
      ].join("\n")
    );
  });

  it("returns null when input is null/undefined/non-object", () => {
    expect(formatProjectCostSummary(null)).toBeNull();
    expect(formatProjectCostSummary(undefined)).toBeNull();
    expect(formatProjectCostSummary("oops")).toBeNull();
  });

  it("returns null when totalUsd is not finite", () => {
    expect(formatProjectCostSummary({ totalUsd: NaN })).toBeNull();
    expect(formatProjectCostSummary({ totalUsd: "not a number" })).toBeNull();
  });

  it("returns null when total is 0 and there are no plans (nothing to show)", () => {
    expect(formatProjectCostSummary({ totalUsd: 0, byPlan: [] })).toBeNull();
    expect(formatProjectCostSummary({ totalUsd: 0 })).toBeNull();
  });

  it("renders a tooltip with no breakdown when byPlan is empty but total > 0", () => {
    const out = formatProjectCostSummary({ totalUsd: 0.25, byPlan: [] });
    expect(out.label).toBe("Total: $0.25");
    expect(out.tooltip).toBe("Total: $0.2500");
  });

  it("appends the 'unknown pricing' note when unknownModelTokens > 0", () => {
    const out = formatProjectCostSummary({
      totalUsd: 0.5,
      byPlan: [],
      unknownModelTokens: { tokensIn: 1200, tokensOut: 800, models: ["mystery-v1"] },
    });
    expect(out.tooltip).toBe(
      ["Total: $0.5000", "(2000 tokens with unknown pricing not included)"].join("\n")
    );
  });

  it("skips the unknown-tokens line when the count is 0", () => {
    const out = formatProjectCostSummary({
      totalUsd: 0.5,
      byPlan: [],
      unknownModelTokens: { tokensIn: 0, tokensOut: 0 },
    });
    expect(out.tooltip).toBe("Total: $0.5000");
  });

  it("falls back to 'unassigned' when a plan has no planId", () => {
    const out = formatProjectCostSummary({
      totalUsd: 0.1,
      byPlan: [{ planId: null, totalUsd: 0.1, huCount: 1 }],
    });
    expect(out.tooltip).toContain("  unassigned: $0.10 (1 HU)");
  });

  it("uses singular HU when huCount is exactly 1", () => {
    const out = formatProjectCostSummary({
      totalUsd: 0.1,
      byPlan: [{ planId: "p1", totalUsd: 0.1, huCount: 1 }],
    });
    expect(out.tooltip).toContain("(1 HU)");
    expect(out.tooltip).not.toContain("(1 HUs)");
  });

  it("skips per-plan rows whose totalUsd isn't finite", () => {
    const out = formatProjectCostSummary({
      totalUsd: 0.5,
      byPlan: [
        { planId: "ok", totalUsd: 0.5, huCount: 2 },
        { planId: "broken", totalUsd: "garbage", huCount: 1 },
      ],
    });
    expect(out.tooltip).toContain("  ok: $0.50 (2 HUs)");
    expect(out.tooltip).not.toContain("broken");
  });
});

// ---------------------------------------------------------------------------
// formatCacheRatio — Φ0-G (KJC-TSK-0525)
// ---------------------------------------------------------------------------
// Per-HU and per-plan cache-hit ratio badge. Returns null when there is
// no signal to show (so the UI hides the badge instead of rendering
// "0%" with no data — same stance as formatCost).
describe("formatCacheRatio", () => {
  it("returns a 1-decimal % label and full-numerator tooltip", () => {
    expect(formatCacheRatio(234, 1000)).toEqual({
      label: "🎯 23.4%",
      tooltip: "Cache hits: 234 / 1,000 input tokens (23.4%)",
    });
  });

  it("rounds to 1 decimal so narrow runs do not appear as 0%", () => {
    expect(formatCacheRatio(7, 1200).label).toBe("🎯 0.6%");
  });

  it("returns null when tokens_in is 0 (ratio is undefined, not zero)", () => {
    expect(formatCacheRatio(0, 0)).toBeNull();
    expect(formatCacheRatio(50, 0)).toBeNull();
  });

  it("returns null on null/undefined/non-finite inputs", () => {
    expect(formatCacheRatio(null, 100)).toBeNull();
    expect(formatCacheRatio(100, null)).toBeNull();
    expect(formatCacheRatio(undefined, undefined)).toBeNull();
    expect(formatCacheRatio(NaN, 100)).toBeNull();
    expect(formatCacheRatio(100, Infinity)).toBeNull();
  });

  it("returns null on negative cached counter (corrupted telemetry)", () => {
    expect(formatCacheRatio(-1, 100)).toBeNull();
  });

  it("renders 100% when every input token was cached", () => {
    expect(formatCacheRatio(500, 500)).toEqual({
      label: "🎯 100%",
      tooltip: "Cache hits: 500 / 500 input tokens (100%)",
    });
  });
});

// ---------------------------------------------------------------------------
// formatProjectCostSummary — Φ0-G additions
// ---------------------------------------------------------------------------
describe("formatProjectCostSummary — Φ0-G cache lines", () => {
  it("appends a Cache line when the project carries cached/in counters", () => {
    const out = formatProjectCostSummary({
      totalUsd: 1, byPlan: [],
      cachedTokens: 350, tokensIn: 1000,
    });
    expect(out.tooltip).toContain("Cache: 350 / 1,000 input tokens (35%)");
  });

  it("appends 🎯 N% suffix to each plan that carries a cachedRatioPct", () => {
    const out = formatProjectCostSummary({
      totalUsd: 2,
      byPlan: [
        { planId: "p1", totalUsd: 1.5, huCount: 2, cachedRatioPct: 42 },
        { planId: "p2", totalUsd: 0.5, huCount: 1, cachedRatioPct: null },
      ],
    });
    expect(out.tooltip).toContain("  p1: $1.50 (2 HUs) 🎯 42%");
    expect(out.tooltip).toContain("  p2: $0.50 (1 HU)");
    expect(out.tooltip).not.toContain("p2: $0.50 (1 HU) 🎯");
  });
});
