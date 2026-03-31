import { describe, expect, it } from "vitest";
import { resolvePolicies, applyPolicies, VALID_TASK_TYPES, DEFAULT_POLICIES } from "../../src/guards/policy-resolver.js";

describe("policy-resolver", () => {
  describe("VALID_TASK_TYPES", () => {
    it("contains exactly the eight expected task types", () => {
      expect(VALID_TASK_TYPES).toEqual(new Set(["sw", "infra", "doc", "add-tests", "refactor", "audit", "analysis", "no-code"]));
    });
  });

  describe("DEFAULT_POLICIES", () => {
    it("has an entry for each valid task type", () => {
      for (const t of VALID_TASK_TYPES) {
        expect(DEFAULT_POLICIES).toHaveProperty(t);
      }
    });
  });

  describe("resolvePolicies – default mappings", () => {
    it("sw → all true", () => {
      expect(resolvePolicies("sw")).toEqual({ tdd: true, sonar: true, reviewer: true, testsRequired: true });
    });

    it("infra → only reviewer true", () => {
      expect(resolvePolicies("infra")).toEqual({ tdd: false, sonar: false, reviewer: true, testsRequired: false });
    });

    it("doc → only reviewer true", () => {
      expect(resolvePolicies("doc")).toEqual({ tdd: false, sonar: false, reviewer: true, testsRequired: false });
    });

    it("add-tests → sonar, reviewer, testsRequired true; tdd false", () => {
      expect(resolvePolicies("add-tests")).toEqual({ tdd: false, sonar: true, reviewer: true, testsRequired: true });
    });

    it("refactor → tdd, sonar, reviewer true; testsRequired false", () => {
      expect(resolvePolicies("refactor")).toEqual({ tdd: true, sonar: true, reviewer: true, testsRequired: false });
    });
  });

  describe("resolvePolicies – unknown / null / undefined taskType defaults to sw", () => {
    it("unknown string defaults to sw", () => {
      expect(resolvePolicies("unknown")).toEqual(resolvePolicies("sw"));
    });

    it("null defaults to sw", () => {
      expect(resolvePolicies(null)).toEqual(resolvePolicies("sw"));
    });

    it("undefined defaults to sw", () => {
      expect(resolvePolicies(undefined)).toEqual(resolvePolicies("sw"));
    });

    it("empty string defaults to sw", () => {
      expect(resolvePolicies("")).toEqual(resolvePolicies("sw"));
    });
  });

  describe("resolvePolicies – configOverrides merging", () => {
    it("overrides a single field for a task type", () => {
      const result = resolvePolicies("sw", { sw: { tdd: false } });
      expect(result).toEqual({ tdd: false, sonar: true, reviewer: true, testsRequired: true });
    });

    it("overrides multiple fields", () => {
      const result = resolvePolicies("infra", { infra: { sonar: true, testsRequired: true } });
      expect(result).toEqual({ tdd: false, sonar: true, reviewer: true, testsRequired: true });
    });

    it("ignores overrides for other task types", () => {
      const result = resolvePolicies("doc", { sw: { tdd: false } });
      expect(result).toEqual({ tdd: false, sonar: false, reviewer: true, testsRequired: false });
    });

    it("overrides apply to the resolved type when taskType is unknown", () => {
      const result = resolvePolicies("bogus", { sw: { sonar: false } });
      expect(result).toEqual({ tdd: true, sonar: false, reviewer: true, testsRequired: true });
    });

    it("empty overrides object has no effect", () => {
      expect(resolvePolicies("sw", {})).toEqual(resolvePolicies("sw"));
    });

    it("null overrides has no effect", () => {
      expect(resolvePolicies("sw", null)).toEqual(resolvePolicies("sw"));
    });

    it("undefined overrides has no effect", () => {
      expect(resolvePolicies("sw", undefined)).toEqual(resolvePolicies("sw"));
    });
  });

  describe("applyPolicies", () => {
    it("returns resolved policies and the resolved taskType", () => {
      const result = applyPolicies({ taskType: "doc", policies: {} });
      expect(result).toEqual({
        taskType: "doc",
        tdd: false,
        sonar: false,
        reviewer: true,
        testsRequired: false,
      });
    });

    it("falls back to sw when taskType is null", () => {
      const result = applyPolicies({ taskType: null, policies: {} });
      expect(result.taskType).toBe("sw");
      expect(result.tdd).toBe(true);
      expect(result.sonar).toBe(true);
    });

    it("falls back to sw when taskType is undefined (not provided)", () => {
      const result = applyPolicies({});
      expect(result.taskType).toBe("sw");
    });

    it("applies config policy overrides", () => {
      const result = applyPolicies({
        taskType: "sw",
        policies: { sw: { tdd: false } },
      });
      expect(result.tdd).toBe(false);
      expect(result.sonar).toBe(true);
    });

    it("infra disables tdd, sonar, testsRequired", () => {
      const result = applyPolicies({ taskType: "infra" });
      expect(result.tdd).toBe(false);
      expect(result.sonar).toBe(false);
      expect(result.reviewer).toBe(true);
      expect(result.testsRequired).toBe(false);
    });

    it("add-tests disables tdd but keeps sonar and testsRequired", () => {
      const result = applyPolicies({ taskType: "add-tests" });
      expect(result.tdd).toBe(false);
      expect(result.sonar).toBe(true);
      expect(result.testsRequired).toBe(true);
    });

    it("refactor enables tdd and sonar but not testsRequired", () => {
      const result = applyPolicies({ taskType: "refactor" });
      expect(result.tdd).toBe(true);
      expect(result.sonar).toBe(true);
      expect(result.testsRequired).toBe(false);
    });
  });

  describe("resolvePolicies – does not mutate DEFAULT_POLICIES", () => {
    it("overrides do not leak into DEFAULT_POLICIES", () => {
      const before = { ...DEFAULT_POLICIES.sw };
      resolvePolicies("sw", { sw: { tdd: false } });
      expect(DEFAULT_POLICIES.sw).toEqual(before);
    });
  });
});
