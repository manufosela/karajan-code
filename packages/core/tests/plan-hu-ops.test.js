import { describe, it, expect } from "vitest";
import {
  addHu,
  removeHu,
  updateHu,
  updateHuStatus,
  certifyAllHus,
  assertPlanRunnable,
  computePlanOutcome,
} from "../src/plan-hu-ops.js";

const newPlan = () => ({ planId: "plan-T", hus: [], updatedAt: null });

describe("@karajan/core/plan-hu-ops", () => {
  it("addHu assigns sequential ID + defaults", () => {
    const plan = newPlan();
    const hu = addHu(plan, { title: "T1" });
    expect(hu.id).toBe("hu_plan-T_001");
    expect(hu.status).toBe("pending");
    expect(plan.hus).toHaveLength(1);
  });

  it("removeHu cleans blocked_by + reuse refs", () => {
    const plan = newPlan();
    addHu(plan, { title: "T1" });
    addHu(plan, { title: "T2", blocked_by: ["hu_plan-T_001"], reuse: ["hu_plan-T_001"] });
    expect(removeHu(plan, "hu_plan-T_001")).toBe(true);
    expect(plan.hus[0].blocked_by).toEqual([]);
    expect(plan.hus[0].reuse).toEqual([]);
  });

  it("updateHu only writes allowed fields", () => {
    const plan = newPlan();
    addHu(plan, { title: "T1" });
    updateHu(plan, "hu_plan-T_001", { title: "T1!", id: "evil" });
    expect(plan.hus[0].title).toBe("T1!");
    expect(plan.hus[0].id).toBe("hu_plan-T_001");
  });

  it("updateHuStatus + certifyAllHus + assertPlanRunnable", () => {
    const plan = newPlan();
    addHu(plan, { title: "T1" });
    expect(updateHuStatus(plan, "hu_plan-T_001", "in_progress")).toBe(true);
    addHu(plan, { title: "T2" });
    expect(certifyAllHus(plan)).toBe(1);
    expect(plan.status).toBe("ready");
    expect(() => assertPlanRunnable(plan, "plan-T")).not.toThrow();
  });

  it("assertPlanRunnable throws when no HU certified", () => {
    const plan = newPlan();
    addHu(plan, { title: "T1" });
    expect(() => assertPlanRunnable(plan, "plan-T")).toThrow(/0 HU/);
  });

  it("computePlanOutcome rolls up counts + dedupes", () => {
    const plan = newPlan();
    addHu(plan, { title: "T1" });
    addHu(plan, { title: "T2" });
    plan.hus[0].outcome = { status: "done", pr_url: "u", blockers: [] };
    plan.hus[1].outcome = { status: "failed", pr_url: "u", blockers: ["x"] };
    const o = computePlanOutcome(plan, { duration_ms: 1 });
    expect(o.status).toBe("partial");
    expect(o.counts).toEqual({ done: 1, failed: 1, blocked: 0, pending: 0 });
    expect(o.prs).toEqual(["u"]);
    expect(o.blockers).toEqual(["x"]);
  });
});
