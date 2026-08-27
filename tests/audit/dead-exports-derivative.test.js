// KJC-TSK-0794 PR-C1, AC8 (epic KJC-PCS-0082) — the report LEADS with the
// DERIVATIVE: "went from N to M" is what a reader acts on; the absolute is
// secondary, and the block says how many entered the scan and how many were
// filtered, so a shrinking number is never confused with a shrinking scan.
import { describe, it, expect } from "vitest";
import { formatDeterministicSummary } from "../../src/audit/deterministic-summary.js";
import { computeGrowthDelta } from "../../src/audit/basal-cost.js";

const basal = (dead) => ({ totalLines: 1, totalFiles: 1, dependencies: { total: 0 }, deadExports: dead });

describe("dead-code derivative — AC8", () => {
  it("computeGrowthDelta carries the dead-exports delta when both snapshots measured it", () => {
    const d = computeGrowthDelta(basal([{}, {}, {}]), { ...basal([{}]), timestamp: "T" });
    expect(d.deadExports).toBe(2);
  });
  it("says null — never 0 — when the previous snapshot did not measure them: 'not measured' is not 'unchanged'", () => {
    const d = computeGrowthDelta(basal([]), { totalLines: 1, totalFiles: 1, dependencies: { total: 0 } });
    expect(d.deadExports).toBeNull();
  });
  it("the basal block leads the dead-exports line with the derivative, absolute second", () => {
    const md = formatDeterministicSummary({
      basalCost: basal([{ name: "x", file: "a.js" }]),
      growthDelta: { lines: 0, files: 0, deps: 0, deadExports: 1, since: "2026-08-20" },
    });
    expect(md).toMatch(/- Dead exports: \+1 since last audit — 1 total/);
  });
  it("the knip block leads with the derivative and says how many entered and how many were filtered", () => {
    const md = formatDeterministicSummary({
      deadExports: {
        available: true,
        exports: [{ path: "a.js", rule: "unused-exports", severity: "MINOR" }],
        files: [],
        suppressedCount: 3,
        previous: { exports: 5, files: 1, timestamp: "2026-08-20" },
      },
    });
    expect(md).toMatch(/- Δ dead code: -5 since 2026-08-20 \(now 1\)/);
    expect(md).toMatch(/- 4 entered the scan, 3 filtered as declared false positives, 1 reported/);
  });
  it("without a previous measurement the knip block shows no derivative — and never a fake zero", () => {
    const md = formatDeterministicSummary({
      deadExports: { available: true, exports: [], files: [], suppressedCount: 0 },
    });
    expect(md).not.toMatch(/Δ dead code/);
  });
});
