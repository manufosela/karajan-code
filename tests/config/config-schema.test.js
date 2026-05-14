/**
 * TSK-0318 — Valibot schema validation for Karajan config.
 * Covers schema parse, CLI falsy-override handling, and the known bugs from
 * issue #367 (--no-rebase, --reviewer-retries 0, --max-iterations 0).
 */
import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  parseConfig,
  safeParseConfig,
  formatConfigIssues,
} from "../../src/config/schema.js";
import { applyRunOverrides } from "../../src/config.js";
import * as v from "valibot";

describe("config schema — parse", () => {
  it("accepts an empty object (all fields optional / looseObject)", () => {
    const out = parseConfig({});
    // The schema supplies defaults for max_iterations / hu_max_iterations;
    // every other field remains absent.
    expect(out.max_iterations).toBe(5);
    expect(out.hu_max_iterations).toBe(3);
  });

  it("accepts a realistic Karajan config and passes through unknown keys", () => {
    const input = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      max_iterations: 5,
      development: { methodology: "tdd", require_test_changes: true },
      // looseObject → unknown keys survive parse
      experimental_feature: { foo: 42 },
      guards: { output: { enabled: true } },
    };
    const out = parseConfig(input);
    expect(out.experimental_feature).toEqual({ foo: 42 });
    expect(out.review_mode).toBe("standard");
  });

  it("rejects unknown review_mode with a readable message", () => {
    const res = safeParseConfig({ review_mode: "yolo" });
    expect(res.success).toBe(false);
    expect(res.issues[0].path).toBe("review_mode");
    expect(res.issues[0].message).toMatch(/review_mode must be one of/);
  });

  it("rejects max_iterations <= 0", () => {
    const zero = safeParseConfig({ max_iterations: 0 });
    const neg = safeParseConfig({ max_iterations: -3 });
    expect(zero.success).toBe(false);
    expect(neg.success).toBe(false);
    expect(zero.issues[0].path).toBe("max_iterations");
    expect(zero.issues[0].message).toMatch(/>= 1/);
  });

  it("rejects non-integer max_iterations", () => {
    const res = safeParseConfig({ max_iterations: 3.5 });
    expect(res.success).toBe(false);
    expect(res.issues[0].message).toMatch(/integer/);
  });

  it("rejects invalid development.methodology but preserves others", () => {
    const res = safeParseConfig({ development: { methodology: "cowboy" } });
    expect(res.success).toBe(false);
    expect(res.issues[0].path).toBe("development.methodology");
    expect(res.issues[0].message).toMatch(/tdd \| standard/);
  });

  it("accepts reviewer_options.retries = 0 (valid 'no retries' signal)", () => {
    const out = parseConfig({ reviewer_options: { retries: 0 } });
    expect(out.reviewer_options.retries).toBe(0);
  });

  it("rejects hu_board.port out of range", () => {
    const high = safeParseConfig({ hu_board: { port: 70000 } });
    const low = safeParseConfig({ hu_board: { port: 0 } });
    expect(high.success).toBe(false);
    expect(low.success).toBe(false);
    expect(high.issues[0].path).toBe("hu_board.port");
  });

  it("rejects budget.warn_threshold_pct outside 0-100", () => {
    const tooHigh = safeParseConfig({ budget: { warn_threshold_pct: 150 } });
    const tooLow = safeParseConfig({ budget: { warn_threshold_pct: -10 } });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });

  it("rejects negative max_budget_usd but accepts null and positive", () => {
    expect(safeParseConfig({ max_budget_usd: null }).success).toBe(true);
    expect(safeParseConfig({ max_budget_usd: 50 }).success).toBe(true);
    expect(safeParseConfig({ max_budget_usd: -5 }).success).toBe(false);
  });

  it("parseConfig throws a ValiError on invalid input", () => {
    expect(() => parseConfig({ review_mode: "yolo" })).toThrow(v.ValiError);
  });

  it("formatConfigIssues joins path + message per line", () => {
    const res = safeParseConfig({ review_mode: "yolo", max_iterations: 0 });
    const formatted = formatConfigIssues(res.issues);
    expect(formatted).toMatch(/review_mode:/);
    expect(formatted).toMatch(/max_iterations:/);
  });
});

describe("applyRunOverrides — falsy handling regressions from #367", () => {
  /** Minimal valid baseline config for exercising overrides. */
  function baseline() {
    return {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      max_iterations: 5,
      base_branch: "main",
      sonarqube: { enabled: true },
      session: { max_iteration_minutes: 20, max_total_minutes: 120 },
      reviewer_options: { retries: 1, fallback_reviewer: "codex" },
      development: { methodology: "tdd", require_test_changes: true },
      git: {
        auto_commit: false, auto_push: false, auto_pr: false,
        auto_rebase: true, branch_prefix: "feat/"
      },
      coder_options: { auto_approve: true },
      roles: {
        planner: { provider: null, model: null },
        coder: { provider: null, model: null },
        reviewer: { provider: null, model: null },
        refactorer: { provider: null, model: null },
        solomon: { provider: null, model: null },
        researcher: { provider: null, model: null },
        tester: { provider: null, model: null },
        security: { provider: null, model: null },
        impeccable: { provider: null, model: null },
        triage: { provider: null, model: null },
        discover: { provider: null, model: null },
        architect: { provider: null, model: null },
        hu_reviewer: { provider: null, model: null },
      },
      pipeline: {
        planner: { enabled: false }, refactorer: { enabled: false },
        solomon: { enabled: true }, researcher: { enabled: false },
        tester: { enabled: true }, security: { enabled: true },
        impeccable: { enabled: false }, triage: { enabled: true },
        discover: { enabled: false }, architect: { enabled: false },
        hu_reviewer: { enabled: false },
      },
      serena: { enabled: false },
    };
  }

  // regression-for: regression
  it("--no-rebase → git.auto_rebase=false (was the #367 regression)", () => {
    const out = applyRunOverrides(baseline(), { autoRebase: false });
    expect(out.git.auto_rebase).toBe(false);
  });

  it("--reviewer-retries 0 → reviewer_options.retries=0 (was silently lost)", () => {
    const out = applyRunOverrides(baseline(), { reviewerRetries: 0 });
    expect(out.reviewer_options.retries).toBe(0);
  });

  it("--max-iterations 0 → throws clear schema error instead of silent fallback", () => {
    expect(() => applyRunOverrides(baseline(), { maxIterations: 0 }))
      .toThrow(/max_iterations[\s\S]*>= 1/);
  });

  it("--max-iterations 3 still works (positive integer override)", () => {
    const out = applyRunOverrides(baseline(), { maxIterations: 3 });
    expect(out.max_iterations).toBe(3);
  });

  it("omitting autoRebase keeps the existing value (backward compat)", () => {
    const out = applyRunOverrides(baseline(), {});
    expect(out.git.auto_rebase).toBe(true);
  });

  it("invalid mode via CLI flag errors with schema message", () => {
    expect(() => applyRunOverrides(baseline(), { mode: "yolo" }))
      .toThrow(/review_mode must be one of/);
  });
});

// KJC-TSK-0407: nueva sección model_routing.
describe("config schema — model_routing", () => {
  it("acepta config sin model_routing (campo opcional)", () => {
    const out = parseConfig({});
    expect(out.model_routing).toBeUndefined();
  });

  it("acepta model_routing.by_provider con tiers per provider", () => {
    const out = parseConfig({
      model_routing: {
        by_provider: {
          claude: { trivial: "haiku", medium: "sonnet", complex: "opus" },
          codex: { medium: "o4-mini", complex: "o3" },
        },
      },
    });
    expect(out.model_routing.by_provider.claude.medium).toBe("sonnet");
    expect(out.model_routing.by_provider.codex.complex).toBe("o3");
  });

  it("acepta model_routing.fixed.coder y fixed.reviewer como override total", () => {
    const out = parseConfig({
      model_routing: { fixed: { coder: "claude-sonnet-4-6", reviewer: "opus" } },
    });
    expect(out.model_routing.fixed.coder).toBe("claude-sonnet-4-6");
    expect(out.model_routing.fixed.reviewer).toBe("opus");
  });

  it("acepta fixed.coder = null (uso parcial: solo fija reviewer)", () => {
    const out = parseConfig({
      model_routing: { fixed: { coder: null, reviewer: "opus" } },
    });
    expect(out.model_routing.fixed.coder).toBeNull();
    expect(out.model_routing.fixed.reviewer).toBe("opus");
  });

  it("by_provider acepta providers desconocidos (looseObject — futuro-proof)", () => {
    const out = parseConfig({
      model_routing: { by_provider: { someNewProvider: { medium: "x" } } },
    });
    expect(out.model_routing.by_provider.someNewProvider.medium).toBe("x");
  });
});
