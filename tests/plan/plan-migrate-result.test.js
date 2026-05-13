// KJC-TSK-0394 step 4: tests del migration helper de `result`.
import { describe, it, expect } from "vitest";
import { migratePlanResult } from "../../src/plan/plan-migrate-result.js";
import { inferResultFromLegacyStatus, createPlanV2 } from "../../src/plan/plan-schema.js";
import { addHu } from "../../src/plan/plan-hu-ops.js";

describe("inferResultFromLegacyStatus", () => {
  it("done sin result → pass (asunción: si hubiera fallado estaría en failed)", () => {
    expect(inferResultFromLegacyStatus({ status: "done" })).toBe("pass");
  });
  it("failed sin result → fail", () => {
    expect(inferResultFromLegacyStatus({ status: "failed" })).toBe("fail");
  });
  it("estados no-terminales → null", () => {
    for (const s of ["pending", "certified", "coding", "reviewing", "blocked", "needs_context"]) {
      expect(inferResultFromLegacyStatus({ status: s })).toBe(null);
    }
  });
  it("respeta result existente (idempotencia)", () => {
    expect(inferResultFromLegacyStatus({ status: "done", result: "fail" })).toBe("fail");
    expect(inferResultFromLegacyStatus({ status: "failed", result: "partial" })).toBe("partial");
  });
  it("result null explícito → infiere (migration helper chequea hasOwnProperty antes)", () => {
    expect(inferResultFromLegacyStatus({ status: "done", result: null })).toBe("pass");
  });
});

describe("migratePlanResult", () => {
  function planWith(huStatuses) {
    const plan = createPlanV2("test");
    for (let i = 0; i < huStatuses.length; i += 1) {
      const hu = addHu(plan, { title: `hu ${i}` });
      hu.status = huStatuses[i];
      delete hu.result;       // simula plan legacy sin campo result
    }
    return plan;
  }

  it("siembra result en HUs sin campo", () => {
    const plan = planWith(["done", "failed", "pending", "coding"]);
    const { plan: out, changes } = migratePlanResult(plan);
    expect(changes).toHaveLength(4);
    expect(out.hus.map((h) => h.result)).toEqual(["pass", "fail", null, null]);
  });

  it("es idempotente — segunda pasada NO produce changes", () => {
    const plan = planWith(["done", "failed", "pending"]);
    const { plan: once } = migratePlanResult(plan);
    const { changes: twiceChanges } = migratePlanResult(once);
    expect(twiceChanges).toEqual([]);
  });

  it("no muta el plan original", () => {
    const plan = planWith(["done"]);
    const before = JSON.stringify(plan);
    migratePlanResult(plan);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("plan vacío o sin hus → noop", () => {
    expect(migratePlanResult({ hus: [] }).changes).toEqual([]);
    expect(migratePlanResult({}).changes).toEqual([]);
    expect(migratePlanResult(null).changes).toEqual([]);
  });

  it("respeta HUs que ya tenían result asignado (incluso null explícito)", () => {
    const plan = planWith(["done", "failed"]);
    plan.hus[0].result = "partial";    // ya migrado manualmente
    plan.hus[1].result = null;          // ya migrado explícitamente a null
    const { changes } = migratePlanResult(plan);
    expect(changes).toEqual([]);
  });

  it("actualiza updatedAt cuando hay cambios", async () => {
    const plan = planWith(["done"]);
    plan.updatedAt = "2020-01-01T00:00:00Z";
    const { plan: out } = migratePlanResult(plan);
    expect(out.updatedAt).not.toBe("2020-01-01T00:00:00Z");
  });
});
