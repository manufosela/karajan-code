import { describe, it, expect } from "vitest";
import {
  runStructuralPass, findCycles, breakCycle,
  removeOrphanRefs, assignMissingShortIds,
} from "../../src/plan/plan-structural-pass.js";

// KJC-TSK-0399: post-review structural integrity pass (no LLM).
// Cubre: ciclo simple A↔B, ciclo de 3, short_id auto, ref huérfana, no-op.

const makePlan = (hus) => ({
  planId: "test",
  hus: hus.map((h) => ({ blocked_by: [], reuse: [], short_id: null, ...h })),
  updatedAt: "2026-05-14T00:00:00Z",
});

describe("findCycles", () => {
  it("detecta ciclo simple A↔B", () => {
    const cycles = findCycles([
      { id: "A", blocked_by: ["B"] }, { id: "B", blocked_by: ["A"] },
    ]);
    expect(new Set(cycles[0])).toEqual(new Set(["A", "B"]));
  });
  it("detecta ciclo de 3 A→B→C→A", () => {
    const cycles = findCycles([
      { id: "A", blocked_by: ["C"] }, { id: "B", blocked_by: ["A"] }, { id: "C", blocked_by: ["B"] },
    ]);
    expect(new Set(cycles[0])).toEqual(new Set(["A", "B", "C"]));
  });
  it("plan acíclico → []", () => {
    expect(findCycles([
      { id: "A", blocked_by: [] }, { id: "B", blocked_by: ["A"] },
    ])).toEqual([]);
  });
  it("ignora refs huérfanas", () => {
    expect(findCycles([{ id: "A", blocked_by: ["GHOST"] }])).toEqual([]);
  });
});

describe("breakCycle", () => {
  it("prefiere romper la arista de la HU con menos incoming", () => {
    const plan = makePlan([
      { id: "A", blocked_by: ["B"] }, { id: "B", blocked_by: ["A"] },
      { id: "X", blocked_by: ["A"] }, { id: "Y", blocked_by: ["A"] },
    ]);
    expect(breakCycle(plan, ["A", "B"]).from).toBe("B");
  });
});

describe("removeOrphanRefs", () => {
  it("limpia blocked_by con HU inexistente", () => {
    const plan = makePlan([
      { id: "A", blocked_by: ["GHOST", "B"] }, { id: "B" },
    ]);
    const fixes = removeOrphanRefs(plan);
    expect(fixes[0]).toMatchObject({ kind: "orphan_ref_removed", huId: "A", removed: ["GHOST"] });
    expect(plan.hus.find((h) => h.id === "A").blocked_by).toEqual(["B"]);
  });
});

describe("assignMissingShortIds", () => {
  it("asigna AUTOFIX-NNN continuando la serie", () => {
    const plan = makePlan([
      { id: "A", short_id: "AUTOFIX-007" },
      { id: "B" }, { id: "C", short_id: "USER-001" }, { id: "D" },
    ]);
    assignMissingShortIds(plan);
    expect(plan.hus.find((h) => h.id === "B").short_id).toBe("AUTOFIX-008");
    expect(plan.hus.find((h) => h.id === "D").short_id).toBe("AUTOFIX-009");
    expect(plan.hus.find((h) => h.id === "C").short_id).toBe("USER-001");
  });
});

describe("runStructuralPass", () => {
  it("plan limpio → no-op", () => {
    const plan = makePlan([
      { id: "A", short_id: "X-001" }, { id: "B", short_id: "X-002", blocked_by: ["A"] },
    ]);
    const r = runStructuralPass(plan);
    expect(r).toEqual({ fixes: [], modified: false });
  });
  it("ciclo + ref huérfana + short_id missing → 3 categorías de fix", () => {
    const plan = makePlan([
      { id: "A", blocked_by: ["B", "GHOST"] },
      { id: "B", short_id: "USER-001", blocked_by: ["A"] },
    ]);
    const r = runStructuralPass(plan);
    expect(r.modified).toBe(true);
    const kinds = new Set(r.fixes.map((f) => f.kind));
    expect(kinds.has("orphan_ref_removed")).toBe(true);
    expect(kinds.has("cycle_break")).toBe(true);
    expect(kinds.has("short_id_assigned")).toBe(true);
    expect(findCycles(plan.hus)).toEqual([]);
  });
  it("plan vacío → no-op", () => {
    expect(runStructuralPass({ planId: "x", hus: [] })).toEqual({ fixes: [], modified: false });
  });
});
