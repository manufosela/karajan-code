// Humanización IDs: tests para alias del plan + short_id de HU.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { savePlan, loadPlan, listPlans, plansDir } from "../../src/plan/plan-store.js";
import { createPlanV2, normaliseAcceptanceTests } from "../../src/plan/plan-schema.js";
import { addHu } from "../../src/plan/plan-hu-ops.js";
import { normaliseAlias } from "../../src/plan/plan-id.js";
import { formatHuTable } from "../../src/commands/plan/_shared.js";

let tmpHome;
const projectDir = "/tmp/test-greta-app";

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-alias-"));
  process.env.KJ_HOME = tmpHome;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe("normaliseAlias", () => {
  it("normaliza nombres humanos a slug typeable", () => {
    expect(normaliseAlias("Greta App")).toBe("greta-app");
    expect(normaliseAlias("Linux Assistant Orchestrator")).toBe("linux-assistant-orchestrator");
    expect(normaliseAlias("My Project (v2)")).toBe("my-project-v2");
  });
  it("devuelve null para vacíos/inválidos", () => {
    expect(normaliseAlias("")).toBe(null);
    expect(normaliseAlias(null)).toBe(null);
    expect(normaliseAlias(123)).toBe(null);
  });
  it("acota a 60 chars", () => {
    const long = "a".repeat(200);
    expect(normaliseAlias(long).length).toBeLessThanOrEqual(60);
  });
});

describe("plan alias persistence + resolution", () => {
  it("savePlan asigna alias desde plan.name si no estaba", async () => {
    const plan = createPlanV2("build greta");
    plan.name = "Greta App";
    addHu(plan, { title: "x" });
    await savePlan(projectDir, plan);
    const reloaded = await loadPlan(projectDir, plan.planId);
    expect(reloaded.alias).toBe("greta-app");
  });

  it("loadPlan resuelve por alias humano", async () => {
    const plan = createPlanV2("t");
    plan.name = "Greta App";
    addHu(plan, { title: "x" });
    await savePlan(projectDir, plan);
    const byAlias = await loadPlan(projectDir, "greta-app");
    expect(byAlias).not.toBeNull();
    expect(byAlias.planId).toBe(plan.planId);
  });

  it("loadPlan sigue resolviendo por planId largo", async () => {
    const plan = createPlanV2("t");
    plan.name = "Greta App";
    addHu(plan, { title: "x" });
    await savePlan(projectDir, plan);
    const byId = await loadPlan(projectDir, plan.planId);
    expect(byId.planId).toBe(plan.planId);
  });

  it("colisión de alias resuelve con sufijo -2, -3...", async () => {
    const p1 = createPlanV2("t"); p1.name = "Greta App"; addHu(p1, { title: "x" });
    const p2 = createPlanV2("t"); p2.name = "Greta App"; addHu(p2, { title: "y" });
    const p3 = createPlanV2("t"); p3.name = "Greta App"; addHu(p3, { title: "z" });
    await savePlan(projectDir, p1);
    await savePlan(projectDir, p2);
    await savePlan(projectDir, p3);
    expect((await loadPlan(projectDir, p1.planId)).alias).toBe("greta-app");
    expect((await loadPlan(projectDir, p2.planId)).alias).toBe("greta-app-2");
    expect((await loadPlan(projectDir, p3.planId)).alias).toBe("greta-app-3");
  });

  it("listPlans incluye alias en el resumen", async () => {
    const plan = createPlanV2("t"); plan.name = "Greta App"; addHu(plan, { title: "x" });
    await savePlan(projectDir, plan);
    const list = await listPlans(projectDir);
    expect(list[0].alias).toBe("greta-app");
  });

  it("loadPlan devuelve null para ref inexistente", async () => {
    expect(await loadPlan(projectDir, "nope")).toBeNull();
  });
});

describe("HU short_id", () => {
  it("addHu acepta short_id y lo persiste", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", short_id: "INFRA-001" });
    expect(hu.short_id).toBe("INFRA-001");
  });

  it("addHu deja short_id null cuando no se pasa", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x" });
    expect(hu.short_id).toBe(null);
  });

  it("formatHuTable muestra short_id en la columna ID si está poblado", () => {
    const plan = createPlanV2("t");
    addHu(plan, { title: "first", short_id: "INFRA-001" });
    addHu(plan, { title: "second", short_id: "AUTH-002" });
    const table = formatHuTable(plan.hus);
    expect(table).toMatch(/INFRA-001/);
    expect(table).toMatch(/AUTH-002/);
    expect(table).not.toMatch(/hu_plan-/);
  });

  it("formatHuTable cae al id largo si no hay short_id (HU legacy)", () => {
    const plan = createPlanV2("t");
    addHu(plan, { title: "legacy" });
    const table = formatHuTable(plan.hus);
    expect(table).toMatch(/hu_plan-/);
  });

  it("formatHuTable muestra deps por short_id cuando existen", () => {
    const plan = createPlanV2("t");
    const a = addHu(plan, { title: "first", short_id: "INFRA-001" });
    addHu(plan, { title: "second", short_id: "AUTH-002", blocked_by: [a.id] });
    const table = formatHuTable(plan.hus);
    // El segundo HU debe mostrar la dep como "INFRA-001", no como el id largo
    const secondLine = table.split("\n").find((l) => l.includes("AUTH-002"));
    expect(secondLine).toMatch(/INFRA-001/);
  });
});
