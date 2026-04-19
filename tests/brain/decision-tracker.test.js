import { describe, expect, it } from "vitest";
import {
  createTracker,
  recordDecision,
  checkLimits,
  summarize,
  DEFAULT_MAX_DECISIONS,
  INDECISION_REPEAT_THRESHOLD,
} from "../../src/brain/decision-tracker.js";

function makeDecision(overrides = {}) {
  return {
    rolesOn: ["coder", "reviewer"],
    confidence: "high",
    rationale: "test",
    appliedOverrides: [],
    ...overrides,
  };
}

describe("brain/decision-tracker", () => {
  describe("createTracker", () => {
    it("initializes session.brainDecisions as an array", () => {
      const session = {};
      createTracker(session);
      expect(Array.isArray(session.brainDecisions)).toBe(true);
      expect(session.brainDecisions).toHaveLength(0);
    });

    it("preserves existing decisions on a resumed session", () => {
      const session = { brainDecisions: [{ seq: 1, intent: "sw:simple" }] };
      createTracker(session);
      expect(session.brainDecisions).toHaveLength(1);
    });
  });

  describe("recordDecision", () => {
    it("appends an entry with incrementing seq + timestamp", () => {
      const tracker = createTracker({});
      const e1 = recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      const e2 = recordDecision(tracker, makeDecision(), { taskType: "sw", level: "medium" });
      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
      expect(typeof e1.at).toBe("string");
      expect(Date.parse(e1.at)).not.toBeNaN();
    });

    it("stores intent as taskType:level slug", () => {
      const tracker = createTracker({});
      const entry = recordDecision(tracker, makeDecision(), { taskType: "refactor", level: "medium" });
      expect(entry.intent).toBe("refactor:medium");
    });

    it("handles missing intent fields with ? placeholder", () => {
      const tracker = createTracker({});
      const entry = recordDecision(tracker, makeDecision(), {});
      expect(entry.intent).toBe("?:?");
    });

    it("copies rolesOn and appliedOverrides so later mutations don't leak in", () => {
      const tracker = createTracker({});
      const decision = makeDecision();
      const entry = recordDecision(tracker, decision, { taskType: "sw", level: "simple" });
      decision.rolesOn.push("security"); // mutate input
      expect(entry.rolesOn).not.toContain("security");
    });
  });

  describe("checkLimits", () => {
    it("returns ok when few decisions have been made", () => {
      const tracker = createTracker({});
      recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      expect(checkLimits(tracker)).toEqual(expect.objectContaining({ status: "ok", decisionCount: 1 }));
    });

    it("returns max-reached when the count hits the limit", () => {
      const tracker = createTracker({}, { max: 3 });
      for (let i = 0; i < 3; i++) {
        recordDecision(tracker, makeDecision(), { taskType: "sw", level: `l${i}` });
      }
      const status = checkLimits(tracker);
      expect(status.status).toBe("max-reached");
      expect(status.decisionCount).toBe(3);
      expect(status.detail).toContain("limit 3");
    });

    it("detects indecision when the last N decisions share the same intent", () => {
      const tracker = createTracker({});
      for (let i = 0; i < INDECISION_REPEAT_THRESHOLD; i++) {
        recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      }
      const status = checkLimits(tracker);
      expect(status.status).toBe("indecision");
      expect(status.detail).toContain("sw:simple");
    });

    it("does NOT flag indecision when only earlier decisions shared an intent", () => {
      const tracker = createTracker({});
      recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      recordDecision(tracker, makeDecision(), { taskType: "sw", level: "simple" });
      recordDecision(tracker, makeDecision(), { taskType: "refactor", level: "medium" });
      // The latest decision broke the streak; status should be ok.
      expect(checkLimits(tracker).status).toBe("ok");
    });

    it("exposes DEFAULT_MAX_DECISIONS = 20", () => {
      expect(DEFAULT_MAX_DECISIONS).toBe(20);
    });
  });

  describe("summarize", () => {
    it("reports totals, byIntent histogram, and the last rationale", () => {
      const tracker = createTracker({});
      recordDecision(tracker, makeDecision({ rationale: "first" }), { taskType: "sw", level: "simple" });
      recordDecision(tracker, makeDecision({ rationale: "second" }), { taskType: "sw", level: "simple" });
      recordDecision(tracker, makeDecision({ rationale: "third" }), { taskType: "doc", level: "trivial" });
      const s = summarize(tracker);
      expect(s.total).toBe(3);
      expect(s.byIntent["sw:simple"]).toBe(2);
      expect(s.byIntent["doc:trivial"]).toBe(1);
      expect(s.lastRationale).toBe("third");
    });

    it("returns empty defaults when no decisions were recorded", () => {
      const tracker = createTracker({});
      const s = summarize(tracker);
      expect(s.total).toBe(0);
      expect(s.byIntent).toEqual({});
      expect(s.lastRationale).toBe("");
    });
  });
});
