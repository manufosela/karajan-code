import { describe, expect, it } from "vitest";
import {
  setHuOutcome, setPlanOutcome, computePlanOutcome, addHu, updateHuStatus,
} from "../../src/plan/plan-hu-ops.js";
import { createPlanV2 } from "../../src/plan/plan-schema.js";

function makePlan() {
  const p = createPlanV2("test task");
  addHu(p, { title: "h1" });
  addHu(p, { title: "h2" });
  addHu(p, { title: "h3" });
  return p;
}

describe("setHuOutcome", () => {
  it("stamps the outcome blob with safe defaults for missing fields", () => {
    const plan = makePlan();
    const ok = setHuOutcome(plan, plan.hus[0].id, {
      status: "done",
      summary: "Implementé add(a,b).",
    });
    expect(ok).toBe(true);
    const o = plan.hus[0].outcome;
    expect(o.status).toBe("done");
    expect(o.summary).toBe("Implementé add(a,b).");
    expect(o.commits).toEqual([]);
    expect(o.blockers).toEqual([]);
    expect(o.iterations).toBeNull();
    expect(o.duration_ms).toBeNull();
    expect(o.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves arrays passed in", () => {
    const plan = makePlan();
    setHuOutcome(plan, plan.hus[0].id, {
      status: "failed",
      commits: ["abc123", "def456"],
      blockers: ["sonar gate failed", "tests missing"],
      iterations: 3,
      duration_ms: 124000,
      branch: "feat/x",
      pr_url: "https://github.com/x/y/pull/1",
      summary: "fail",
    });
    const o = plan.hus[0].outcome;
    expect(o.commits).toEqual(["abc123", "def456"]);
    expect(o.blockers).toEqual(["sonar gate failed", "tests missing"]);
    expect(o.iterations).toBe(3);
    expect(o.duration_ms).toBe(124000);
    expect(o.branch).toBe("feat/x");
    expect(o.pr_url).toBe("https://github.com/x/y/pull/1");
  });

  it("returns false when the HU id is unknown", () => {
    const plan = makePlan();
    expect(setHuOutcome(plan, "no-such-hu", { status: "done" })).toBe(false);
  });
});

describe("computePlanOutcome", () => {
  it("counts statuses and dedupes prs + blockers", () => {
    const plan = makePlan();
    setHuOutcome(plan, plan.hus[0].id, { status: "done", pr_url: "https://x/pull/1" });
    setHuOutcome(plan, plan.hus[1].id, { status: "failed", blockers: ["sonar fail"], pr_url: "https://x/pull/2" });
    setHuOutcome(plan, plan.hus[2].id, { status: "failed", blockers: ["sonar fail", "tests missing"] });
    updateHuStatus(plan, plan.hus[0].id, "done");
    updateHuStatus(plan, plan.hus[1].id, "failed");
    updateHuStatus(plan, plan.hus[2].id, "failed");

    const r = computePlanOutcome(plan, { duration_ms: 950000 });
    expect(r.total).toBe(3);
    expect(r.counts).toEqual({ done: 1, failed: 2, blocked: 0, pending: 0 });
    expect(r.status).toBe("partial");
    expect(r.duration_ms).toBe(950000);
    expect(r.prs).toEqual(["https://x/pull/1", "https://x/pull/2"]);
    expect(r.blockers).toEqual(["sonar fail", "tests missing"]);
    expect(r.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns status=done when every HU is done", () => {
    const plan = makePlan();
    for (const hu of plan.hus) {
      updateHuStatus(plan, hu.id, "done");
      setHuOutcome(plan, hu.id, { status: "done" });
    }
    const r = computePlanOutcome(plan);
    expect(r.status).toBe("done");
    expect(r.counts).toEqual({ done: 3, failed: 0, blocked: 0, pending: 0 });
  });

  it("returns status=failed when none are done", () => {
    const plan = makePlan();
    for (const hu of plan.hus) {
      updateHuStatus(plan, hu.id, "failed");
      setHuOutcome(plan, hu.id, { status: "failed" });
    }
    const r = computePlanOutcome(plan);
    expect(r.status).toBe("failed");
  });

  it("returns status=pending when no HU has terminal status yet", () => {
    const plan = makePlan();
    const r = computePlanOutcome(plan);
    expect(r.status).toBe("pending");
  });
});

describe("setPlanOutcome", () => {
  it("stamps the rollup blob with sensible defaults", () => {
    const plan = makePlan();
    setPlanOutcome(plan, { status: "done", total: 3, counts: { done: 3, failed: 0, blocked: 0, pending: 0 } });
    expect(plan.outcome.status).toBe("done");
    expect(plan.outcome.total).toBe(3);
    expect(plan.outcome.prs).toEqual([]);
    expect(plan.outcome.blockers).toEqual([]);
    expect(plan.outcome.finishedAt).toMatch(/^\d{4}/);
    expect(plan.updatedAt).toMatch(/^\d{4}/);
  });

  it("dedupes prs + blockers passed in", () => {
    const plan = makePlan();
    setPlanOutcome(plan, {
      status: "partial", total: 3,
      prs: ["a", "b", "a", "", null],
      blockers: ["x", "y", "x"],
    });
    expect(plan.outcome.prs).toEqual(["a", "b"]);
    expect(plan.outcome.blockers).toEqual(["x", "y"]);
  });
});
