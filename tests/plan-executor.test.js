// KJC-BUG-0110: planToHuBatch must carry `scope` into the batch stories —
// the parallel scheduler treats scopeless stories as exclusive, so losing
// it silently turns --parallel N into a sequential run.
import { describe, expect, it } from "vitest";
import { planToHuBatch } from "../src/plan/plan-executor.js";
import { partitionConflictFree } from "../src/orchestrator/hu-scheduler.js";

const PLAN = {
  version: 2,
  planId: "plan-test",
  hus: [
    { id: "A", title: "A", status: "certified", blocked_by: [], scope: "Implementar src/sum/sum.js y tests/sum.test.js" },
    { id: "B", title: "B", status: "certified", blocked_by: [], scope: "Implementar src/mult/mult.js y tests/mult.test.js" },
    { id: "C", title: "C", status: "certified", blocked_by: [], scope: "Implementar src/greet/greet.js y tests/greet.test.js" }
  ]
};

describe("planToHuBatch scope passthrough (KJC-BUG-0110)", () => {
  it("stories keep the plan's scope as their own field", () => {
    const batch = planToHuBatch(PLAN);
    expect(batch.ok).toBe(true);
    for (const [i, hu] of PLAN.hus.entries()) {
      expect(batch.stories[i].scope).toBe(hu.scope);
    }
  });

  it("converted stories with disjoint scopes still pair under --parallel 2", () => {
    const { stories } = planToHuBatch(PLAN);
    const chunks = partitionConflictFree(stories, ["A", "B", "C"], 2);
    expect(chunks).toEqual([["A", "B"], ["C"]]);
  });

  it("a plan HU without scope converts to scope null (exclusive lane)", () => {
    const { stories } = planToHuBatch({ version: 2, planId: "p", hus: [{ id: "X", title: "X", status: "certified", blocked_by: [] }] });
    expect(stories[0].scope).toBeNull();
  });
});
