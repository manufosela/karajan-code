import { describe, expect, it } from "vitest";
import {
  normaliseAcceptanceTest,
  normaliseAcceptanceTests,
  createPlanV2,
  validatePlan,
} from "../src/plan/plan-schema.js";
import { addHu } from "../src/plan/plan-hu-ops.js";

// Tests-first schema (v2.7.5): planner now emits a structured
// { type: "shell"|"gherkin", content, file? } per test, and the legacy
// plain-string form is still accepted for backwards compatibility.

describe("normaliseAcceptanceTest", () => {
  it("upgrades a legacy plain string to { type: shell }", () => {
    expect(normaliseAcceptanceTest("npx vitest run")).toEqual({
      type: "shell",
      content: "npx vitest run",
    });
  });

  it("keeps explicit shell objects as-is", () => {
    expect(normaliseAcceptanceTest({ type: "shell", content: "ls /tmp" })).toEqual({
      type: "shell",
      content: "ls /tmp",
    });
  });

  it("keeps gherkin objects and trims content", () => {
    expect(
      normaliseAcceptanceTest({ type: "gherkin", content: "  Given x\nWhen y\nThen z  " })
    ).toEqual({ type: "gherkin", content: "Given x\nWhen y\nThen z" });
  });

  it("includes file when provided and non-empty", () => {
    expect(
      normaliseAcceptanceTest({ type: "shell", content: "tsc --noEmit", file: "tsconfig.json" })
    ).toEqual({ type: "shell", content: "tsc --noEmit", file: "tsconfig.json" });
  });

  it("drops empty / whitespace-only / missing-content entries", () => {
    expect(normaliseAcceptanceTest("")).toBeNull();
    expect(normaliseAcceptanceTest("   ")).toBeNull();
    expect(normaliseAcceptanceTest(null)).toBeNull();
    expect(normaliseAcceptanceTest(undefined)).toBeNull();
    expect(normaliseAcceptanceTest({ type: "shell", content: "" })).toBeNull();
    expect(normaliseAcceptanceTest({ foo: "bar" })).toBeNull();
  });

  it("defaults unknown test types to shell (no silent data loss)", () => {
    expect(
      normaliseAcceptanceTest({ type: "python", content: "pytest" })
    ).toEqual({ type: "shell", content: "pytest" });
  });
});

describe("normaliseAcceptanceTests", () => {
  it("returns [] for a non-array", () => {
    expect(normaliseAcceptanceTests(null)).toEqual([]);
    expect(normaliseAcceptanceTests("string")).toEqual([]);
    expect(normaliseAcceptanceTests(undefined)).toEqual([]);
  });

  it("filters out empties and keeps valid entries in order", () => {
    const result = normaliseAcceptanceTests([
      "echo PASS",
      { type: "gherkin", content: "Given x\nWhen y\nThen z" },
      "",
      null,
      { foo: "bar" },
      { type: "shell", content: "tsc --noEmit", file: "tsconfig.json" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "shell", content: "echo PASS" });
    expect(result[1]).toEqual({ type: "gherkin", content: "Given x\nWhen y\nThen z" });
    expect(result[2]).toEqual({ type: "shell", content: "tsc --noEmit", file: "tsconfig.json" });
  });
});

describe("validatePlan — acceptance_tests validation", () => {
  it("accepts a plan with structured shell + gherkin tests", () => {
    const plan = createPlanV2("build it");
    addHu(plan, {
      title: "write thing",
      scope: "do the thing",
      acceptance_tests: [
        { type: "shell", content: "tsc --noEmit" },
        { type: "gherkin", content: "Given x\nWhen y\nThen z" },
      ],
    });
    expect(validatePlan(plan).valid).toBe(true);
  });

  it("accepts legacy plain-string acceptance_tests (backward compat)", () => {
    const plan = createPlanV2("build it");
    addHu(plan, {
      title: "legacy",
      scope: "old-style",
      acceptance_tests: ["npx vitest run"],
    });
    expect(validatePlan(plan).valid).toBe(true);
  });

  it("rejects tests with invalid type", () => {
    const plan = createPlanV2("build it");
    addHu(plan, {
      title: "bad",
      scope: "scope",
      acceptance_tests: [{ type: "python", content: "pytest" }],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("acceptance_tests[0].type"))).toBe(true);
  });

  it("rejects tests whose content is missing or blank", () => {
    const plan = createPlanV2("build it");
    addHu(plan, {
      title: "empty",
      scope: "scope",
      acceptance_tests: [{ type: "shell", content: "" }, { type: "gherkin", content: "   " }],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.includes(".content")).length).toBe(2);
  });

  it("rejects acceptance_tests that isn't an array", () => {
    const plan = createPlanV2("build it");
    plan.hus.push({
      id: "plan-x_001",
      title: "bad",
      status: "pending",
      acceptance_tests: "not-an-array",
      blocked_by: [],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be an array"))).toBe(true);
  });
});
