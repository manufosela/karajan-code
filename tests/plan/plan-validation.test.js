import { describe, it, expect } from "vitest";
import { validateBlockedByChange } from "../../src/plan/plan-validation.js";

// KJC-TSK-0401: validación de cambios en blocked_by para edición desde
// el board. Rechaza auto-deps, refs huérfanas y ciclos.

const makePlan = (hus) => ({ planId: "p", hus: hus.map((h) => ({ blocked_by: [], ...h })) });

describe("validateBlockedByChange", () => {
  it("acepta cambio válido sin ciclos ni huérfanos", () => {
    const plan = makePlan([
      { id: "A" }, { id: "B" }, { id: "C" },
    ]);
    expect(validateBlockedByChange(plan, "A", ["B"])).toEqual({ ok: true });
    expect(validateBlockedByChange(plan, "C", ["A", "B"])).toEqual({ ok: true });
  });

  it("rechaza array vacío como válido (no es error)", () => {
    const plan = makePlan([{ id: "A", blocked_by: ["B"] }, { id: "B" }]);
    expect(validateBlockedByChange(plan, "A", [])).toEqual({ ok: true });
  });

  it("rechaza referencia a HU inexistente", () => {
    const plan = makePlan([{ id: "A" }, { id: "B" }]);
    const r = validateBlockedByChange(plan, "A", ["GHOST"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inexistente.*GHOST/);
  });

  it("rechaza auto-dependencia A → A", () => {
    const plan = makePlan([{ id: "A" }]);
    const r = validateBlockedByChange(plan, "A", ["A"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/auto-dependencia/);
  });

  it("rechaza ciclo directo A↔B (A bloqueada por B, intento B bloqueada por A)", () => {
    const plan = makePlan([
      { id: "A", blocked_by: ["B"] }, { id: "B" },
    ]);
    const r = validateBlockedByChange(plan, "B", ["A"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ciclo detectado/);
    expect(r.cycle).toBeDefined();
  });

  it("rechaza ciclo indirecto A→B→C→A", () => {
    const plan = makePlan([
      { id: "A", blocked_by: ["C"] },
      { id: "B", blocked_by: ["A"] },
      { id: "C" },
    ]);
    const r = validateBlockedByChange(plan, "C", ["B"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ciclo detectado/);
  });

  it("rechaza payload no-array", () => {
    const plan = makePlan([{ id: "A" }]);
    const r = validateBlockedByChange(plan, "A", "B");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array/);
  });

  it("rechaza valor no-string dentro del array", () => {
    const plan = makePlan([{ id: "A" }, { id: "B" }]);
    const r = validateBlockedByChange(plan, "A", [123]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no-string/);
  });

  it("rechaza HU no presente en el plan", () => {
    const plan = makePlan([{ id: "A" }]);
    const r = validateBlockedByChange(plan, "ZZZ", []);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no encontrada/);
  });

  it("plan inválido (sin hus[]) → error", () => {
    expect(validateBlockedByChange(null, "A", []).ok).toBe(false);
    expect(validateBlockedByChange({}, "A", []).ok).toBe(false);
  });
});
