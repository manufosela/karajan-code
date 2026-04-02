import { describe, expect, it } from "vitest";
import { validatePolicyCompliance } from "../../src/guards/policy-guard.js";

describe("validatePolicyCompliance", () => {
  describe("bypass patterns", () => {
    const bypassPhrases = [
      "skip the tests",
      "skip TDD",
      "ignore the reviewer",
      "ignore reviewer feedback",
      "continue without tests",
      "continue without testing",
      "disable TDD",
      "disable tests",
      "switch to standard methodology",
      "switch methodology to standard",
      "don't run tests",
      "no need for tests",
      "approve without review",
      "mark as approved",
      "bypass the reviewer",
      "just ship it without review",
      "skip sonar",
      "ignore sonar issues",
      "disable security checks",
      "skip security",
    ];

    for (const phrase of bypassPhrases) {
      it(`rejects: "${phrase}"`, () => {
        const result = validatePolicyCompliance(phrase);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeTruthy();
        expect(result.suggestions).toBeInstanceOf(Array);
        expect(result.suggestions.length).toBeGreaterThan(0);
      });
    }
  });

  describe("valid answers", () => {
    const validPhrases = [
      "the coder should create test files first, then implement",
      "focus on fixing the type error in line 42",
      "try a different approach: use a Map instead of an object",
      "1",
      "2",
      "continue",
      "stop",
      "the test expects a string but the function returns a number",
      "add error handling for the null case",
      "split the function into smaller units",
    ];

    for (const phrase of validPhrases) {
      it(`accepts: "${phrase}"`, () => {
        const result = validatePolicyCompliance(phrase);
        expect(result.valid).toBe(true);
      });
    }
  });

  describe("context-aware suggestions", () => {
    it("suggests TDD guidance for reviewer_fail_fast context", () => {
      const result = validatePolicyCompliance("skip the tests", "reviewer_fail_fast");
      expect(result.valid).toBe(false);
      expect(result.suggestions.some(s => /guidance|feedback|approach/i.test(s))).toBe(true);
    });

    it("suggests alternatives for max_iterations context", () => {
      const result = validatePolicyCompliance("ignore the reviewer", "max_iterations");
      expect(result.valid).toBe(false);
      expect(result.suggestions.some(s => /iteration|continue|guidance/i.test(s))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("accepts null answer", () => {
      const result = validatePolicyCompliance(null);
      expect(result.valid).toBe(true);
    });

    it("accepts empty string", () => {
      const result = validatePolicyCompliance("");
      expect(result.valid).toBe(true);
    });

    it("accepts numeric choice", () => {
      const result = validatePolicyCompliance("3");
      expect(result.valid).toBe(true);
    });
  });
});
