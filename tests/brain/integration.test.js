import { describe, expect, it } from "vitest";
import { buildDecision, applyDecisionToFlags } from "../../src/brain/decisor.js";
import { createTracker, recordDecision, checkLimits } from "../../src/brain/decision-tracker.js";

/**
 * Integration coverage of the Brain decisor: full flow from triage output
 * through buildDecision → applyDecisionToFlags → tracker recording. Also
 * verifies the test-harness globalThis override defaults Brain OFF.
 */

describe("brain integration — full routing flow", () => {
  describe("triage → decision → flags", () => {
    it("medium sw task + force-security produces flags with security on", () => {
      const triage = { level: "medium", roles: [], taskType: "sw", confidence: 0.8 };
      const decision = buildDecision({
        triage,
        task: "add rate limiter",
        overrides: { forceRoles: ["security"] },
      });
      const flags = applyDecisionToFlags(decision, {});
      expect(flags.securityEnabled).toBe(true);
      expect(flags.testerEnabled).toBe(true);
      expect(flags.reviewerEnabled).toBe(true);
      expect(flags.coderEnabled).toBe(true);
    });

    it("complex refactor task activates architect + tester + refactorer", () => {
      const triage = { level: "complex", roles: [], taskType: "refactor", confidence: 0.9 };
      const decision = buildDecision({ triage, task: "refactor auth" });
      const flags = applyDecisionToFlags(decision, {});
      expect(flags.architectEnabled).toBe(true);
      expect(flags.refactorerEnabled).toBe(true);
      expect(flags.testerEnabled).toBe(true);
    });

    it("doc task on trivial level drops tester + security; only coder + reviewer remain", () => {
      const triage = { level: "simple", roles: [], taskType: "doc", confidence: 0.9 };
      const decision = buildDecision({ triage, task: "update README" });
      const flags = applyDecisionToFlags(decision, {});
      expect(flags.coderEnabled).toBe(true);
      expect(flags.reviewerEnabled).toBe(true);
      expect(flags.testerEnabled).toBe(false);
      expect(flags.securityEnabled).toBe(false);
    });

    it("config.pipeline.security.enabled=false forces security off even on complex tasks", () => {
      const triage = { level: "complex", roles: [], taskType: "sw", confidence: 0.9 };
      const decision = buildDecision({
        triage,
        task: "x",
        config: { pipeline: { security: { enabled: false } } },
      });
      const flags = applyDecisionToFlags(decision, {});
      expect(flags.securityEnabled).toBe(false);
    });
  });

  describe("Solomon consultation path", () => {
    it("low-confidence decision marks consultSolomon=true", () => {
      const triage = { level: "simple", roles: [], taskType: "sw", confidence: 0.4 };
      const decision = buildDecision({ triage, task: "do thing" });
      expect(decision.consultSolomon).toBe(true);
      expect(decision.solomonReason).toContain("0.40");
    });

    it("missing level triggers Solomon consult", () => {
      const decision = buildDecision({ triage: { roles: [] } });
      expect(decision.consultSolomon).toBe(true);
    });
  });

  describe("tracker records decisions across iterations", () => {
    it("records every buildDecision call and detects indecision after 3 identical intents", () => {
      const session = {};
      const tracker = createTracker(session);
      for (let i = 0; i < 3; i++) {
        const triage = { level: "medium", roles: [], taskType: "sw", confidence: 0.9 };
        const decision = buildDecision({ triage });
        recordDecision(tracker, decision, { taskType: "sw", level: "medium" });
      }
      const status = checkLimits(tracker);
      expect(status.status).toBe("indecision");
      expect(session.brainDecisions).toHaveLength(3);
    });

    it("stops recording once max is reached", () => {
      const session = {};
      const tracker = createTracker(session, { max: 2 });
      const triage = { level: "simple", roles: [], taskType: "sw", confidence: 0.9 };
      const d = buildDecision({ triage });
      recordDecision(tracker, d, { taskType: "sw", level: "simple" });
      recordDecision(tracker, d, { taskType: "sw", level: "simple" });
      const status = checkLimits(tracker);
      expect(status.status).toBe("max-reached");
    });
  });

  describe("test harness globalThis override", () => {
    it("globalThis.__KJ_DEFAULT_BRAIN_DECISOR is false by default in tests", () => {
      expect(globalThis.__KJ_DEFAULT_BRAIN_DECISOR).toBe(false);
    });
  });
});
