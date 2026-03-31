import { describe, it, expect } from "vitest";
import { classifyIntent } from "../src/guards/intent-guard.js";
import { resolvePolicies, applyPolicies, VALID_TASK_TYPES } from "../src/guards/policy-resolver.js";
import { buildTriagePrompt } from "../src/prompts/triage.js";

describe("no-code mode", () => {
  describe("intent classification", () => {
    it("classifies 'Generate SQL queries for sales analysis' as no-code", () => {
      const result = classifyIntent("Generate SQL queries for sales analysis");
      expect(result.classified).toBe(true);
      expect(result.taskType).toBe("no-code");
      expect(result.patternId).toBe("no-code");
    });

    it("classifies 'Analizar datos del CSV de ventas' as no-code (Spanish)", () => {
      const result = classifyIntent("Analizar datos del CSV de ventas");
      expect(result.classified).toBe(true);
      expect(result.taskType).toBe("no-code");
      expect(result.patternId).toBe("no-code");
    });

    it("does NOT classify 'Build a REST API' as no-code", () => {
      const result = classifyIntent("Build a REST API");
      // Should either not classify or classify as something other than no-code
      if (result.classified) {
        expect(result.taskType).not.toBe("no-code");
      }
    });

    it("classifies 'generate report of monthly revenue' as no-code", () => {
      const result = classifyIntent("generate report of monthly revenue");
      expect(result.classified).toBe(true);
      expect(result.taskType).toBe("no-code");
    });

    it("classifies 'transform csv to JSON format' as no-code", () => {
      const result = classifyIntent("transform csv to JSON format");
      expect(result.classified).toBe(true);
      expect(result.taskType).toBe("no-code");
    });

    it("classifies 'exportar a Excel los datos de clientes' as no-code (Spanish)", () => {
      const result = classifyIntent("exportar a Excel los datos de clientes");
      expect(result.classified).toBe(true);
      expect(result.taskType).toBe("no-code");
    });
  });

  describe("policy resolution", () => {
    it("no-code is a valid task type", () => {
      expect(VALID_TASK_TYPES.has("no-code")).toBe(true);
    });

    it("no-code policy disables tdd and sonar but enables coder and reviewer", () => {
      const policies = resolvePolicies("no-code");
      expect(policies.tdd).toBe(false);
      expect(policies.sonar).toBe(false);
      expect(policies.reviewer).toBe(true);
      expect(policies.testsRequired).toBe(false);
      expect(policies.coderRequired).toBe(true);
    });

    it("applyPolicies resolves no-code correctly", () => {
      const result = applyPolicies({ taskType: "no-code" });
      expect(result.taskType).toBe("no-code");
      expect(result.tdd).toBe(false);
      expect(result.sonar).toBe(false);
      expect(result.reviewer).toBe(true);
      expect(result.coderRequired).toBe(true);
    });
  });

  describe("pipeline behavior with no-code", () => {
    it("no-code policies disable TDD methodology", () => {
      const policies = resolvePolicies("no-code");
      expect(policies.tdd).toBe(false);
    });

    it("no-code policies disable SonarQube", () => {
      const policies = resolvePolicies("no-code");
      expect(policies.sonar).toBe(false);
    });

    it("no-code policies keep coder active (coderRequired is true)", () => {
      const policies = resolvePolicies("no-code");
      expect(policies.coderRequired).toBe(true);
    });

    it("no-code policies keep reviewer active", () => {
      const policies = resolvePolicies("no-code");
      expect(policies.reviewer).toBe(true);
    });
  });

  describe("triage prompt", () => {
    it("includes no-code in taskType enum", () => {
      const prompt = buildTriagePrompt({ task: "Generate SQL queries" });
      expect(prompt).toContain("no-code");
    });

    it("includes no-code decision guideline", () => {
      const prompt = buildTriagePrompt({ task: "Generate SQL queries" });
      expect(prompt).toContain("no-code taskType");
      expect(prompt).toContain("data analysis");
      expect(prompt).toContain("document generation");
    });
  });
});
