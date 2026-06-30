import { describe, it, expect } from "vitest";
import { buildAssessment } from "../../src/start/assessment.js";

/**
 * KJC-TSK-0569 (Onboard B) — deterministic synthesis.
 *
 * buildAssessment reduces the 0568 sweep bundle to a digest + machine summary.
 * Pure, no LLM. Asserts: gap derivation, improvement tally, null-safe optional
 * slots (new project has no drift/rag/qmd), and the advisory section is folded
 * in when present.
 */
function bundle(over = {}) {
  return {
    projectDir: "/x",
    maturity: { maturity: "existing", reasons: ["code with tests and CI"], deepHealthRecommended: false, declared: false },
    signals: { hasSourceCode: true, scaffoldingOnly: false, hasTests: true, hasCI: true, commitCount: 40, staleDays: 5 },
    drift: { ok: true, checks: [] },
    improvements: { artifacts: [{ recommendation: "install", dir: ".", file: "eslint.config.js", foundAt: "eslint.config.js", rationale: "missing", improvements: [] }] },
    rag: { indexed: true, chunks: 10 },
    qmd: { available: true },
    ...over,
  };
}

describe("buildAssessment (KJC-TSK-0569)", () => {
  it("summarizes a healthy existing project with no gaps", () => {
    const { text, summary } = buildAssessment(bundle());
    expect(summary.maturity).toBe("existing");
    expect(summary.gaps).toEqual([]);
    expect(summary.improvementCounts.install).toBe(1);
    expect(summary.indexed).toBe(true);
    expect(text).toMatch(/maturity: existing \(inferred\)/);
  });

  it("derives gaps from missing tests/CI and stale commits", () => {
    const { summary } = buildAssessment(bundle({
      signals: { hasTests: false, hasCI: false, commitCount: 3, staleDays: 540 },
      maturity: { maturity: "legacy", reasons: ["neglected"], deepHealthRecommended: true, declared: false },
    }));
    expect(summary.gaps).toContain("no tests");
    expect(summary.gaps).toContain("no CI");
    expect(summary.gaps.some((g) => /540d old/.test(g))).toBe(true);
    expect(summary.deepHealthRecommended).toBe(true);
  });

  it("counts drifting harden checks as a gap", () => {
    const { summary } = buildAssessment(bundle({
      drift: { ok: false, checks: [{ id: "a", ok: false }, { id: "b", ok: true }] },
    }));
    expect(summary.driftOk).toBe(false);
    expect(summary.gaps.some((g) => /1 harden check/.test(g))).toBe(true);
  });

  it("is null-safe for a new project with no deep signals", () => {
    const { text, summary } = buildAssessment(bundle({
      maturity: { maturity: "new", reasons: ["no source code found"], deepHealthRecommended: false, declared: false },
      drift: null, improvements: null, rag: null, qmd: null,
    }));
    expect(summary.indexed).toBeNull();
    expect(summary.qmdAvailable).toBeNull();
    expect(summary.improvementCounts).toEqual({ install: 0, update: 0, review: 0, keep: 0 });
    expect(text).toMatch(/maturity: new/);
  });

  it("folds in the harden advisory report when improvements are present", () => {
    const { text } = buildAssessment(bundle());
    expect(text).toMatch(/kj harden — advisory report/);
  });

  it("throws on a missing or non-object bundle", () => {
    expect(() => buildAssessment(null)).toThrow(TypeError);
    expect(() => buildAssessment("nope")).toThrow(TypeError);
  });
});
