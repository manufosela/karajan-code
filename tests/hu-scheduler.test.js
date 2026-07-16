import { describe, expect, it } from "vitest";

import { scopeTokens, husConflict, selectRunnableHus } from "../src/orchestrator/hu-scheduler.js";

const hu = (id, scope, blocked_by = []) => ({ id, scope, blocked_by });

describe("hu-scheduler (KJC-TSK-0623)", () => {
  it("scopeTokens extracts path bases from prose and globs", () => {
    expect(scopeTokens("src/auth y tests/auth")).toEqual(["src/auth", "tests/auth"]);
    expect(scopeTokens("docs/**/*.md")).toEqual(["docs"]);
    expect(scopeTokens("touch src/api/users.js, src/api/roles.js")).toEqual([
      "src/api/users.js",
      "src/api/roles.js",
    ]);
    expect(scopeTokens(null)).toEqual([]);
    expect(scopeTokens("mejorar el rendimiento general")).toEqual([]);
  });

  it("husConflict: prefix overlap conflicts, disjoint trees don't, no scope is exclusive", () => {
    expect(husConflict(hu("a", "src/auth"), hu("b", "src/auth/login"))).toBe(true);
    expect(husConflict(hu("a", "src/auth"), hu("b", "src/billing"))).toBe(false);
    expect(husConflict(hu("a", null), hu("b", "src/billing"))).toBe(true);
    expect(husConflict(hu("a", "texto sin rutas"), hu("b", "src/billing"))).toBe(true);
  });

  it("respects the dependency graph", () => {
    const { selected, blocked } = selectRunnableHus({
      hus: [hu("A", "src/a"), hu("B", "src/b", ["A"]), hu("C", "src/c", ["A", "B"])],
      completedIds: ["A"],
      maxParallel: 3,
    });
    expect(selected.map((h) => h.id)).toEqual(["B"]);
    expect(blocked).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "C", reason: "waiting for B" })]),
    );
  });

  it("serializes scope conflicts against in-flight and already-selected HUs", () => {
    const { selected, blocked } = selectRunnableHus({
      hus: [hu("B", "src/auth/tokens"), hu("C", "src/billing"), hu("D", "src/billing/invoices")],
      inFlight: [{ id: "A", scope: "src/auth" }],
      maxParallel: 3,
    });
    expect(selected.map((h) => h.id)).toEqual(["C"]);
    const reasons = Object.fromEntries(blocked.map((b) => [b.id, b.reason]));
    expect(reasons.B).toContain("scope conflicts with A");
    expect(reasons.D).toContain("scope conflicts with C");
  });

  it("caps at maxParallel counting the in-flight HUs and skips them as candidates", () => {
    const { selected, blocked } = selectRunnableHus({
      hus: [hu("A", "src/a"), hu("B", "src/b"), hu("C", "src/c")],
      inFlight: [{ id: "A", scope: "src/a" }],
      maxParallel: 2,
    });
    expect(selected.map((h) => h.id)).toEqual(["B"]);
    expect(blocked).toEqual([{ id: "C", reason: "no free slot" }]);
  });

  it("default maxParallel of 1 reproduces today's sequential behaviour", () => {
    const { selected } = selectRunnableHus({ hus: [hu("A", "src/a"), hu("B", "src/b")] });
    expect(selected.map((h) => h.id)).toEqual(["A"]);
  });
});
