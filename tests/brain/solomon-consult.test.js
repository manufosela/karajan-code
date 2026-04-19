import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeSolomon = vi.fn();

vi.mock("../../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: (...args) => invokeSolomon(...args),
}));

describe("brain/solomon-consult", () => {
  let buildRoutingConflict, applyRulingToDecision, consultSolomonForRouting;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ buildRoutingConflict, applyRulingToDecision, consultSolomonForRouting } =
      await import("../../src/brain/solomon-consult.js"));
  });

  describe("buildRoutingConflict", () => {
    it("packs decision + triage into a conflict object with routing stage", () => {
      const decision = {
        rolesOn: ["coder", "reviewer"],
        rolesOff: ["tester"],
        confidence: "low",
        rationale: "level=medium",
        solomonReason: "triage confidence 0.40 < 0.6",
        appliedOverrides: [],
        consultSolomon: true,
      };
      const triage = { level: "medium", taskType: "sw", confidence: 0.4 };
      const conflict = buildRoutingConflict({ decision, triage, task: "do X" });
      expect(conflict.stage).toBe("brain-routing");
      expect(conflict.task).toBe("do X");
      expect(conflict.reason).toContain("0.40");
      expect(conflict.detail.rolesOn).toEqual(["coder", "reviewer"]);
      expect(conflict.detail.triageLevel).toBe("medium");
    });
  });

  describe("applyRulingToDecision", () => {
    const baseline = {
      rolesOn: ["coder", "reviewer"],
      rolesOff: ["tester", "security", "architect"],
      confidence: "low",
      rationale: "baseline",
      appliedOverrides: [],
      consultSolomon: true,
    };

    it("adds a role when Solomon suggests 'add security'", () => {
      const ruling = { action: "continue", suggestedActions: ["add security"] };
      const out = applyRulingToDecision(baseline, ruling, logger);
      expect(out.rolesOn).toContain("security");
      expect(out.rolesOff).not.toContain("security");
      expect(out.appliedOverrides).toContain("solomon-add:security");
      expect(out.consultSolomon).toBe(false);
      expect(out.confidence).toBe("high");
    });

    it("removes a role when Solomon suggests 'skip tester'", () => {
      const withTester = { ...baseline, rolesOn: ["coder", "reviewer", "tester"], rolesOff: ["security", "architect"] };
      const ruling = { action: "continue", suggestedActions: ["Skip tester — no new functionality."] };
      const out = applyRulingToDecision(withTester, ruling, logger);
      expect(out.rolesOn).not.toContain("tester");
      expect(out.rolesOff).toContain("tester");
      expect(out.appliedOverrides).toContain("solomon-skip:tester");
    });

    it("handles 'enable X' and 'disable X' synonyms", () => {
      const r1 = applyRulingToDecision(baseline, { suggestedActions: ["enable architect"] }, logger);
      expect(r1.rolesOn).toContain("architect");
      const r2 = applyRulingToDecision(
        { ...baseline, rolesOn: [...baseline.rolesOn, "refactorer"], rolesOff: baseline.rolesOff.filter(r => r !== "refactorer") },
        { suggestedActions: ["disable refactorer"] },
        logger
      );
      expect(r2.rolesOn).not.toContain("refactorer");
    });

    it("leaves decision alone when suggestedActions is empty (ignoring sort order)", () => {
      const out = applyRulingToDecision(baseline, { action: "approve", suggestedActions: [] }, logger);
      expect([...out.rolesOn].sort()).toEqual([...baseline.rolesOn].sort());
      expect([...out.rolesOff].sort()).toEqual([...baseline.rolesOff].sort());
      expect(out.confidence).toBe(baseline.confidence);
    });

    it("includes Solomon verdict in the rationale", () => {
      const out = applyRulingToDecision(baseline, { action: "continue", suggestedActions: ["add security"] }, logger);
      expect(out.rationale).toContain("solomon=continue");
      expect(out.rationale).toContain("solomon-add:security");
    });
  });

  describe("consultSolomonForRouting", () => {
    const triage = { level: "medium", taskType: "sw", confidence: 0.4 };
    const decision = {
      rolesOn: ["coder", "reviewer"],
      rolesOff: ["tester", "security", "architect", "planner", "researcher", "refactorer", "impeccable", "discover", "hu_reviewer", "solomon", "triage"],
      confidence: "low",
      rationale: "ambiguous",
      consultSolomon: true,
      solomonReason: "low-confidence triage",
      appliedOverrides: [],
    };

    it("returns the decision unchanged when consultSolomon=false", async () => {
      const baseline = { ...decision, consultSolomon: false };
      const out = await consultSolomonForRouting({ decision: baseline, triage, task: "x", config: {}, logger });
      expect(out).toBe(baseline);
      expect(invokeSolomon).not.toHaveBeenCalled();
    });

    it("applies Solomon's ruling when the invocation succeeds", async () => {
      invokeSolomon.mockResolvedValue({ action: "continue", suggestedActions: ["add security"] });
      const out = await consultSolomonForRouting({ decision, triage, task: "x", config: {}, logger });
      expect(out.rolesOn).toContain("security");
      expect(out.consultSolomon).toBe(false);
    });

    it("keeps baseline when invokeSolomon throws", async () => {
      invokeSolomon.mockRejectedValue(new Error("solomon down"));
      const out = await consultSolomonForRouting({ decision, triage, task: "x", config: {}, logger });
      expect(out.rolesOn).toEqual(decision.rolesOn);
      expect(out.rationale).toContain("solomon=failed");
    });

    it("keeps baseline when ruling is missing/null", async () => {
      invokeSolomon.mockResolvedValue(null);
      const out = await consultSolomonForRouting({ decision, triage, task: "x", config: {}, logger });
      expect(out.rolesOn).toEqual(decision.rolesOn);
      expect(out.rationale).toContain("solomon=no-ruling");
    });
  });
});
