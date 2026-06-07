import { describe, it, expect } from "vitest";
import { validateBlockedByChange } from "../src/plan-validation.js";

const plan = () => ({
  hus: [
    { id: "a", blocked_by: [] },
    { id: "b", blocked_by: ["a"] },
    { id: "c", blocked_by: ["b"] },
  ],
});

describe("@karajan/core/plan-validation", () => {
  it("ok when the new blocked_by is a valid subset", () => {
    expect(validateBlockedByChange(plan(), "c", ["a"]).ok).toBe(true);
  });

  it("rejects self-dependency", () => {
    const r = validateBlockedByChange(plan(), "a", ["a"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/auto-dependencia/);
  });

  it("rejects unknown HU reference", () => {
    const r = validateBlockedByChange(plan(), "a", ["zzz"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inexistente/);
  });

  it("rejects cycle creation", () => {
    const r = validateBlockedByChange(plan(), "a", ["c"]);
    expect(r.ok).toBe(false);
    expect(r.cycle).toBeDefined();
    expect(r.error).toMatch(/Ciclo/);
  });

  it("rejects non-array blocked_by", () => {
    expect(validateBlockedByChange(plan(), "a", "nope").ok).toBe(false);
  });
});
