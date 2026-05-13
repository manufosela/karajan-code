import { describe, it, expect, beforeEach } from "vitest";
import { generatePlanId, generateHuId } from "../../src/plan/plan-id.js";
import { createPlanV2, migratePlanV1toV2, isPlanV2, validatePlan, mapLegacyStatusToResult, VALID_HU_RESULTS } from "../../src/plan/plan-schema.js";
import { addHu, removeHu, updateHu, updateHuStatus, certifyAllHus, reorderHus } from "../../src/plan/plan-hu-ops.js";

describe("plan-id", () => {
  it("generates unique plan IDs", () => {
    const a = generatePlanId();
    const b = generatePlanId();
    expect(a).toMatch(/^plan-\d{14}-[a-z0-9]{4}$/);
    expect(a).not.toBe(b);
  });

  it("generates unique HU IDs scoped to plan", () => {
    const id = generateHuId("plan-20260407-ab12", 1);
    expect(id).toBe("hu_plan-20260407-ab12_001");
    expect(generateHuId("plan-20260407-ab12", 42)).toBe("hu_plan-20260407-ab12_042");
  });
});

describe("plan-schema", () => {
  it("creates empty v2 plan", () => {
    const plan = createPlanV2("Build API", { researchContext: "notes" });
    expect(plan.version).toBe(2);
    expect(plan.task).toBe("Build API");
    expect(plan.status).toBe("draft");
    expect(plan.hus).toEqual([]);
    expect(plan.context.researchContext).toBe("notes");
    expect(plan.planId).toMatch(/^plan-/);
  });

  it("detects v2 plans", () => {
    expect(isPlanV2({ version: 2, hus: [] })).toBe(true);
    expect(isPlanV2({ planId: "old", task: "x" })).toBe(false);
    expect(isPlanV2(null)).toBe(false);
  });

  it("migrates v1 to v2", () => {
    const v1 = {
      planId: "plan-old",
      task: "Build API",
      researchContext: "notes",
      plan: { approach: "REST", risks: ["timeout"] },
      raw: "raw output"
    };
    const v2 = migratePlanV1toV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.planId).toBe("plan-old");
    expect(v2.task).toBe("Build API");
    expect(v2.approach).toBe("REST");
    expect(v2.risks).toEqual(["timeout"]);
    expect(v2.hus).toEqual([]);
    expect(v2._v1.raw).toBe("raw output");
  });

  it("validates correct plan", () => {
    const plan = createPlanV2("Build API");
    addHu(plan, { title: "Setup" });
    expect(validatePlan(plan).valid).toBe(true);
  });

  it("rejects plan with missing fields", () => {
    const result = validatePlan({ version: 2, hus: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing planId");
    expect(result.errors).toContain("Missing task");
  });

  it("detects duplicate HU IDs", () => {
    const plan = createPlanV2("Build API");
    plan.hus = [
      { id: "hu_x_001", title: "A", status: "pending" },
      { id: "hu_x_001", title: "B", status: "pending" }
    ];
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
  });

  it("detects circular dependencies", () => {
    const plan = createPlanV2("Build API");
    plan.hus = [
      { id: "a", title: "A", status: "pending", blocked_by: ["b"] },
      { id: "b", title: "B", status: "pending", blocked_by: ["a"] }
    ];
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Circular"))).toBe(true);
  });
});

describe("plan-hu-ops", () => {
  let plan;

  beforeEach(() => {
    plan = createPlanV2("Build API");
  });

  it("adds HU with unique ID", () => {
    const hu = addHu(plan, { title: "Setup", task_type: "infra" });
    expect(hu.id).toMatch(/^hu_plan-.*_001$/);
    expect(hu.title).toBe("Setup");
    expect(hu.task_type).toBe("infra");
    expect(hu.status).toBe("pending");
    expect(plan.hus.length).toBe(1);
  });

  // KJC-TSK-0394: campo `result` ortogonal al status
  it("addHu inicializa result a null por defecto", () => {
    const hu = addHu(plan, { title: "X" });
    expect(hu.result).toBe(null);
  });

  it("addHu acepta result inicial cuando se pasa explícitamente", () => {
    const hu = addHu(plan, { title: "X", result: "pass" });
    expect(hu.result).toBe("pass");
  });

  it("updateHu permite mutar el campo result", () => {
    const hu = addHu(plan, { title: "X" });
    updateHu(plan, hu.id, { result: "fail" });
    expect(plan.hus[0].result).toBe("fail");
  });

  it("validatePlan rechaza result fuera del enum", () => {
    const hu = addHu(plan, { title: "X" });
    hu.result = "weird-value";
    const v = validatePlan(plan);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /invalid result/i.test(e))).toBe(true);
  });

  it("validatePlan acepta result null/pass/fail/partial", () => {
    for (const r of [null, "pass", "fail", "partial"]) {
      const p = createPlanV2(`task ${r}`);
      const hu = addHu(p, { title: "X" });
      hu.result = r;
      const v = validatePlan(p);
      expect(v.valid, `result=${r}`).toBe(true);
    }
  });

  it("VALID_HU_RESULTS contiene exactamente null+pass+fail+partial", () => {
    expect(VALID_HU_RESULTS.has(null)).toBe(true);
    expect(VALID_HU_RESULTS.has("pass")).toBe(true);
    expect(VALID_HU_RESULTS.has("fail")).toBe(true);
    expect(VALID_HU_RESULTS.has("partial")).toBe(true);
    expect(VALID_HU_RESULTS.has("done")).toBe(false);
    expect(VALID_HU_RESULTS.size).toBe(4);
  });

  it("sequential IDs increment", () => {
    addHu(plan, { title: "First" });
    const second = addHu(plan, { title: "Second" });
    expect(second.id).toMatch(/_002$/);
  });

  it("removes HU and cleans dependencies", () => {
    const hu1 = addHu(plan, { title: "Setup" });
    addHu(plan, { title: "Auth", blocked_by: [hu1.id] });
    expect(plan.hus[1].blocked_by).toContain(hu1.id);

    removeHu(plan, hu1.id);
    expect(plan.hus.length).toBe(1);
    expect(plan.hus[0].blocked_by).toEqual([]);
  });

  it("updates HU fields", () => {
    const hu = addHu(plan, { title: "Old" });
    updateHu(plan, hu.id, { title: "New", acceptance_tests: ["echo PASS"] });
    expect(plan.hus[0].title).toBe("New");
    expect(plan.hus[0].acceptance_tests).toEqual(["echo PASS"]);
  });

  // KJC-BUG-0044 / P3: reuse marker — declares the HU piggy-backs on
  // another HU's implementation instead of reimplementing it.
  it("addHu defaults reuse to empty array", () => {
    const hu = addHu(plan, { title: "Standalone" });
    expect(hu.reuse).toEqual([]);
  });

  it("addHu preserves reuse ids when provided", () => {
    const a = addHu(plan, { title: "Crypto util" });
    const b = addHu(plan, { title: "Uses crypto", reuse: [a.id] });
    expect(b.reuse).toEqual([a.id]);
  });

  it("removeHu cleans dangling reuse references", () => {
    const a = addHu(plan, { title: "Crypto util" });
    const b = addHu(plan, { title: "Uses crypto", reuse: [a.id] });
    removeHu(plan, a.id);
    expect(plan.hus.length).toBe(1);
    expect(plan.hus[0].id).toBe(b.id);
    expect(plan.hus[0].reuse).toEqual([]);
  });

  it("updateHu allows mutating the reuse list", () => {
    const a = addHu(plan, { title: "Util A" });
    const b = addHu(plan, { title: "Consumer" });
    updateHu(plan, b.id, { reuse: [a.id] });
    expect(plan.hus[1].reuse).toEqual([a.id]);
  });

  it("ignores unknown patch fields", () => {
    const hu = addHu(plan, { title: "Test" });
    updateHu(plan, hu.id, { title: "New", dangerousField: "hack" });
    expect(plan.hus[0].dangerousField).toBeUndefined();
  });

  it("updates HU status", () => {
    const hu = addHu(plan, { title: "Test" });
    updateHuStatus(plan, hu.id, "coding");
    expect(plan.hus[0].status).toBe("coding");
  });

  it("certifies all pending HUs", () => {
    addHu(plan, { title: "A" });
    addHu(plan, { title: "B" });
    const count = certifyAllHus(plan);
    expect(count).toBe(2);
    expect(plan.status).toBe("ready");
    expect(plan.hus.every(h => h.status === "certified")).toBe(true);
  });

  it("reorders HUs", () => {
    const a = addHu(plan, { title: "A" });
    const b = addHu(plan, { title: "B" });
    const c = addHu(plan, { title: "C" });
    reorderHus(plan, [c.id, a.id, b.id]);
    expect(plan.hus.map(h => h.title)).toEqual(["C", "A", "B"]);
  });

  it("returns null for operations on nonexistent HU", () => {
    expect(updateHu(plan, "fake", { title: "x" })).toBeNull();
    expect(updateHuStatus(plan, "fake", "done")).toBe(false);
    expect(removeHu(plan, "fake")).toBe(false);
  });
});

describe("mapLegacyStatusToResult (KJC-TSK-0394 migration)", () => {
  it("pending → pending+null", () => {
    expect(mapLegacyStatusToResult("pending")).toEqual({ status: "pending", result: null });
  });
  it("blocked/needs_context → pending+null (lifecycle non-terminal)", () => {
    expect(mapLegacyStatusToResult("blocked")).toEqual({ status: "pending", result: null });
    expect(mapLegacyStatusToResult("needs_context")).toEqual({ status: "pending", result: null });
  });
  it("coding/reviewing/running → running+null (zombi recovery)", () => {
    expect(mapLegacyStatusToResult("coding")).toEqual({ status: "running", result: null });
    expect(mapLegacyStatusToResult("reviewing")).toEqual({ status: "running", result: null });
    expect(mapLegacyStatusToResult("running")).toEqual({ status: "running", result: null });
  });
  it("certified → done+pass (success en el modelo viejo)", () => {
    expect(mapLegacyStatusToResult("certified")).toEqual({ status: "done", result: "pass" });
  });
  it("failed → done+fail", () => {
    expect(mapLegacyStatusToResult("failed")).toEqual({ status: "done", result: "fail" });
  });
  it("done → done+null (status terminal sin info de result)", () => {
    expect(mapLegacyStatusToResult("done")).toEqual({ status: "done", result: null });
  });
  it("undefined/null/desconocido → pending+null (defensive)", () => {
    expect(mapLegacyStatusToResult(null)).toEqual({ status: "pending", result: null });
    expect(mapLegacyStatusToResult(undefined)).toEqual({ status: "pending", result: null });
    expect(mapLegacyStatusToResult("weird")).toEqual({ status: "pending", result: null });
  });
  it("idempotente — re-mapear un valor canónico no rompe", () => {
    expect(mapLegacyStatusToResult("pending").status).toBe("pending");
    expect(mapLegacyStatusToResult("done").status).toBe("done");
  });
});
