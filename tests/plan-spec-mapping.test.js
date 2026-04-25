import { describe, expect, it } from "vitest";
import { addHu, updateHu } from "../src/plan/plan-hu-ops.js";
import { createPlanV2 } from "../src/plan/plan-schema.js";

// PR C: every HU now carries a `spec_section` pointer to the SPEC.md
// heading it implements. Free-form string. The planner LLM emits it
// when the source task has structured headings; older plans / hand-
// edited HUs may have `null` and that's fine.

describe("plan HU spec_section", () => {
  it("addHu defaults spec_section to null when not provided", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", scope: "do x" });
    expect(hu.spec_section).toBeNull();
  });

  it("addHu carries the spec_section when provided", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", scope: "do x", spec_section: "5.3" });
    expect(hu.spec_section).toBe("5.3");
  });

  it("updateHu can edit spec_section in place", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", scope: "do x" });
    expect(hu.spec_section).toBeNull();
    const updated = updateHu(plan, hu.id, { spec_section: "§5 Initial Scope" });
    expect(updated.spec_section).toBe("§5 Initial Scope");
  });

  it("updateHu's spec_section change is reflected on the same object reference", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", scope: "do x" });
    updateHu(plan, hu.id, { spec_section: "1.1" });
    expect(plan.hus[0].spec_section).toBe("1.1");
  });

  it("non-allowlisted fields are still ignored by updateHu (whitelist sanity)", () => {
    const plan = createPlanV2("t");
    const hu = addHu(plan, { title: "x", scope: "do x" });
    updateHu(plan, hu.id, { spec_section: "9.9", arbitrary_field: "should be dropped" });
    expect(plan.hus[0].spec_section).toBe("9.9");
    expect(plan.hus[0].arbitrary_field).toBeUndefined();
  });
});
