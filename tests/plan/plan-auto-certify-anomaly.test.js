import { describe, expect, it } from "vitest";
import {
  autoCertifyPendingHus, assertPlanRunnable, addHu,
} from "../src/plan/plan-hu-ops.js";
import { createPlanV2 } from "../src/plan/plan-schema.js";

function makePlan(huSpecs) {
  const plan = createPlanV2("test");
  for (const spec of huSpecs) addHu(plan, spec);
  return plan;
}

// PR-E: helpers that gate a plan-based run so the orchestrator can never
// silently fall back to single-task mode on a broken / un-ready plan.

describe("autoCertifyPendingHus", () => {
  it("promotes pending HUs that have at least one acceptance test", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "echo a" }] },
      { title: "b", acceptance_tests: [{ type: "gherkin", content: "Given\nWhen\nThen" }] },
    ]);
    expect(plan.hus.every((h) => h.status === "pending")).toBe(true);
    const promoted = autoCertifyPendingHus(plan);
    expect(promoted).toBe(2);
    expect(plan.hus.every((h) => h.status === "certified")).toBe(true);
  });

  it("skips pending HUs that have no acceptance tests", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "echo a" }] },
      { title: "b", acceptance_tests: [] },     // no tests → not promoted
    ]);
    const promoted = autoCertifyPendingHus(plan);
    expect(promoted).toBe(1);
    expect(plan.hus[0].status).toBe("certified");
    expect(plan.hus[1].status).toBe("pending");
  });

  it("leaves done / failed / blocked HUs alone", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "b", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "c", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    plan.hus[0].status = "done";
    plan.hus[1].status = "failed";
    plan.hus[2].status = "blocked";
    const promoted = autoCertifyPendingHus(plan);
    expect(promoted).toBe(0);
    expect(plan.hus.map((h) => h.status)).toEqual(["done", "failed", "blocked"]);
  });

  it("returns 0 on empty / missing plans", () => {
    expect(autoCertifyPendingHus(null)).toBe(0);
    expect(autoCertifyPendingHus({})).toBe(0);
    expect(autoCertifyPendingHus({ hus: [] })).toBe(0);
  });

  it("stamps updatedAt on every promoted HU and on the plan", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    const before = plan.hus[0].updatedAt;
    // wait one ms so timestamps differ
    return new Promise((r) => setTimeout(r, 5)).then(() => {
      autoCertifyPendingHus(plan);
      expect(plan.hus[0].updatedAt).not.toBe(before);
      expect(plan.updatedAt).toBe(plan.hus[0].updatedAt);
    });
  });
});

describe("assertPlanRunnable", () => {
  it("throws when the plan has zero HUs", () => {
    expect(() => assertPlanRunnable({ hus: [] }, "plan-X")).toThrow(/no contiene ninguna HU/);
    expect(() => assertPlanRunnable({}, "plan-X")).toThrow(/no contiene ninguna HU/);
    expect(() => assertPlanRunnable(null, "plan-X")).toThrow(/no contiene ninguna HU/);
  });

  it("throws when no HU is in 'certified' state", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "b", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    plan.hus[0].status = "done";
    plan.hus[1].status = "failed";
    expect(() => assertPlanRunnable(plan, "plan-Y")).toThrow(/0 HU\(s\) listas para ejecutar/);
  });

  it("includes the status counts in the error so the user knows where things are", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "b", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "c", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    plan.hus[0].status = "done";
    plan.hus[1].status = "failed";
    plan.hus[2].status = "blocked";
    try {
      assertPlanRunnable(plan, "plan-Z");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.message).toMatch(/1 done/);
      expect(err.message).toMatch(/1 failed/);
      expect(err.message).toMatch(/1 blocked/);
      expect(err.message).toMatch(/--hu <id>/);
    }
  });

  it("returns silently when at least one HU is certified", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    plan.hus[0].status = "certified";
    expect(() => assertPlanRunnable(plan, "plan-W")).not.toThrow();
  });

  it("treats pending HUs as not runnable (caller must auto-certify first)", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
    ]);
    expect(plan.hus[0].status).toBe("pending");
    expect(() => assertPlanRunnable(plan, "plan-V")).toThrow(/0 HU\(s\) listas para ejecutar/);
  });
});

describe("autoCertify + assertPlanRunnable composition", () => {
  it("the typical happy path: pending → certified → runnable", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [{ type: "shell", content: "x" }] },
      { title: "b", acceptance_tests: [{ type: "gherkin", content: "G\nW\nT" }] },
    ]);
    autoCertifyPendingHus(plan);
    expect(() => assertPlanRunnable(plan, "plan-OK")).not.toThrow();
  });

  it("pending without tests stays unrunnable even after auto-certify", () => {
    const plan = makePlan([
      { title: "a", acceptance_tests: [] },     // no tests → never promoted
      { title: "b", acceptance_tests: [] },
    ]);
    autoCertifyPendingHus(plan);
    expect(() => assertPlanRunnable(plan, "plan-NO-TESTS")).toThrow(/0 HU\(s\) listas/);
  });
});
