import { describe, expect, it } from "vitest";
import { buildDecision, applyDecisionToFlags, VALID_ROLES } from "../../src/brain/decisor.js";

describe("brain/decisor", () => {
  describe("baseline by complexity level", () => {
    it("trivial → coder only", () => {
      const d = buildDecision({ triage: { level: "trivial", roles: [], taskType: "sw", confidence: 0.9 } });
      expect(d.rolesOn).toEqual(["coder"]);
      expect(d.confidence).toBe("high");
    });

    it("simple → coder + reviewer", () => {
      const d = buildDecision({ triage: { level: "simple", roles: [], taskType: "sw", confidence: 0.9 } });
      expect(d.rolesOn).toContain("coder");
      expect(d.rolesOn).toContain("reviewer");
      expect(d.rolesOn).not.toContain("tester");
    });

    it("medium → adds tester", () => {
      const d = buildDecision({ triage: { level: "medium", roles: [], taskType: "sw", confidence: 0.9 } });
      expect(d.rolesOn).toContain("tester");
    });

    it("complex → full pipeline including architect + planner + security", () => {
      const d = buildDecision({ triage: { level: "complex", roles: [], taskType: "sw", confidence: 0.9 } });
      expect(d.rolesOn).toContain("researcher");
      expect(d.rolesOn).toContain("architect");
      expect(d.rolesOn).toContain("planner");
      expect(d.rolesOn).toContain("security");
    });
  });

  describe("taskType adjustments", () => {
    it("doc tasks drop tester + security + refactorer", () => {
      const d = buildDecision({ triage: { level: "medium", roles: [], taskType: "doc", confidence: 0.9 } });
      expect(d.rolesOn).not.toContain("tester");
      expect(d.rolesOn).not.toContain("security");
      expect(d.rolesOn).not.toContain("refactorer");
    });

    it("refactor tasks add refactorer + tester", () => {
      const d = buildDecision({ triage: { level: "simple", roles: [], taskType: "refactor", confidence: 0.9 } });
      expect(d.rolesOn).toContain("refactorer");
      expect(d.rolesOn).toContain("tester");
    });

    it("infra tasks add architect + security", () => {
      const d = buildDecision({ triage: { level: "simple", roles: [], taskType: "infra", confidence: 0.9 } });
      expect(d.rolesOn).toContain("architect");
      expect(d.rolesOn).toContain("security");
    });

    it("audit tasks drop coder and add reviewer + security", () => {
      const d = buildDecision({ triage: { level: "medium", roles: [], taskType: "audit", confidence: 0.9 } });
      expect(d.rolesOn).not.toContain("coder");
      expect(d.rolesOn).toContain("reviewer");
      expect(d.rolesOn).toContain("security");
    });

    it("no-code tasks drop coder + reviewer + tester", () => {
      const d = buildDecision({ triage: { level: "simple", roles: [], taskType: "no-code", confidence: 0.9 } });
      expect(d.rolesOn).not.toContain("coder");
      expect(d.rolesOn).not.toContain("reviewer");
      expect(d.rolesOn).not.toContain("tester");
    });
  });

  describe("triage.roles merge", () => {
    it("adds triage-suggested roles on top of baseline", () => {
      const d = buildDecision({
        triage: { level: "simple", roles: ["researcher", "architect"], taskType: "sw", confidence: 0.9 },
      });
      expect(d.rolesOn).toContain("researcher");
      expect(d.rolesOn).toContain("architect");
    });

    it("ignores invalid role names from triage", () => {
      const d = buildDecision({
        triage: { level: "simple", roles: ["bogus", "coder"], taskType: "sw", confidence: 0.9 },
      });
      expect(d.rolesOn).not.toContain("bogus");
      expect(d.rolesOn).toContain("coder");
    });
  });

  describe("config.pipeline.X.enabled=false", () => {
    it("respects user config forcing a role off", () => {
      const d = buildDecision({
        triage: { level: "complex", roles: [], taskType: "sw", confidence: 0.9 },
        config: { pipeline: { security: { enabled: false } } },
      });
      expect(d.rolesOn).not.toContain("security");
    });
  });

  describe("CLI overrides win", () => {
    it("--skip-role removes a role even if baseline would include it", () => {
      const d = buildDecision({
        triage: { level: "medium", roles: [], taskType: "sw", confidence: 0.9 },
        overrides: { skipRoles: ["tester"] },
      });
      expect(d.rolesOn).not.toContain("tester");
      expect(d.appliedOverrides).toContain("skip:tester");
    });

    it("--force-role adds a role even if baseline excludes it", () => {
      const d = buildDecision({
        triage: { level: "trivial", roles: [], taskType: "sw", confidence: 0.9 },
        overrides: { forceRoles: ["security"] },
      });
      expect(d.rolesOn).toContain("security");
      expect(d.appliedOverrides).toContain("force:security");
    });

    it("ignores unknown role names in overrides", () => {
      const d = buildDecision({
        triage: { level: "simple", roles: [], taskType: "sw", confidence: 0.9 },
        overrides: { forceRoles: ["bogus"], skipRoles: ["fake"] },
      });
      expect(d.appliedOverrides).toEqual([]);
    });
  });

  describe("Solomon consult signal", () => {
    it("consultSolomon=true when confidence < 0.6", () => {
      const d = buildDecision({
        triage: { level: "simple", roles: [], taskType: "sw", confidence: 0.4 },
      });
      expect(d.consultSolomon).toBe(true);
      expect(d.confidence).toBe("low");
      expect(d.solomonReason).toContain("0.40");
    });

    it("consultSolomon=true when triage.level is missing", () => {
      const d = buildDecision({ triage: { roles: [], taskType: "sw" } });
      expect(d.consultSolomon).toBe(true);
      expect(d.confidence).toBe("low");
    });

    it("confidence=high when triage reports >=0.85", () => {
      const d = buildDecision({
        triage: { level: "simple", roles: [], taskType: "sw", confidence: 0.9 },
      });
      expect(d.confidence).toBe("high");
      expect(d.consultSolomon).toBe(false);
    });
  });

  describe("invariants", () => {
    it("always includes coder unless audit/no-code or explicit skip", () => {
      const d1 = buildDecision({ triage: { level: "trivial", roles: [], taskType: "sw", confidence: 0.9 } });
      expect(d1.rolesOn).toContain("coder");
      const d2 = buildDecision({ triage: { level: "simple", roles: [], taskType: "doc", confidence: 0.9 } });
      expect(d2.rolesOn).toContain("coder");
    });

    it("rolesOff covers every valid role that's not rolesOn", () => {
      const d = buildDecision({ triage: { level: "simple", roles: [], taskType: "sw", confidence: 0.9 } });
      const onSet = new Set(d.rolesOn);
      for (const r of d.rolesOff) expect(onSet.has(r)).toBe(false);
      expect([...d.rolesOn, ...d.rolesOff].length).toBe(VALID_ROLES.size);
    });
  });

  describe("rationale", () => {
    it("mentions level, taskType and role list", () => {
      const d = buildDecision({
        triage: { level: "medium", roles: [], taskType: "refactor", confidence: 0.9 },
      });
      expect(d.rationale).toContain("level=medium");
      expect(d.rationale).toContain("taskType=refactor");
      expect(d.rationale).toContain("roles=");
    });

    it("mentions applied overrides when present", () => {
      const d = buildDecision({
        triage: { level: "medium", roles: [], taskType: "sw", confidence: 0.9 },
        overrides: { skipRoles: ["tester"] },
      });
      expect(d.rationale).toContain("overrides=");
      expect(d.rationale).toContain("skip:tester");
    });
  });
});

describe("brain/decisor — applyDecisionToFlags", () => {
  it("sets rolesOn-corresponding flags to true", () => {
    const decision = { rolesOn: ["researcher", "architect"], rolesOff: [], appliedOverrides: [], consultSolomon: false, confidence: "high", rationale: "" };
    const flags = applyDecisionToFlags(decision, {});
    expect(flags.researcherEnabled).toBe(true);
    expect(flags.architectEnabled).toBe(true);
  });

  it("sets rolesOff-corresponding flags to false", () => {
    const decision = { rolesOn: [], rolesOff: ["tester", "security"], appliedOverrides: [], consultSolomon: false, confidence: "high", rationale: "" };
    const flags = applyDecisionToFlags(decision, { testerEnabled: true, securityEnabled: true });
    expect(flags.testerEnabled).toBe(false);
    expect(flags.securityEnabled).toBe(false);
  });

  it("maps hu_reviewer → huReviewerEnabled (camel)", () => {
    const decision = { rolesOn: ["hu_reviewer"], rolesOff: [], appliedOverrides: [], consultSolomon: false, confidence: "medium", rationale: "" };
    const flags = applyDecisionToFlags(decision, {});
    expect(flags.huReviewerEnabled).toBe(true);
  });

  it("does not mutate input", () => {
    const input = { testerEnabled: true };
    const frozen = Object.freeze({ ...input });
    const decision = { rolesOn: ["researcher"], rolesOff: ["tester"], appliedOverrides: [], consultSolomon: false, confidence: "high", rationale: "" };
    const flags = applyDecisionToFlags(decision, frozen);
    expect(flags.testerEnabled).toBe(false);
    expect(frozen.testerEnabled).toBe(true);
  });

  it("preserves unrelated flags", () => {
    const flags = applyDecisionToFlags(
      { rolesOn: ["researcher"], rolesOff: [], appliedOverrides: [], consultSolomon: false, confidence: "high", rationale: "" },
      { someOtherFlag: "untouched" }
    );
    expect(flags.someOtherFlag).toBe("untouched");
  });
});
