import { describe, expect, it } from "vitest";
import {
  detectIndicators,
  selectHeuristic,
  INDICATOR_CATEGORIES,
  HEURISTIC_DESCRIPTIONS
} from "../src/hu/splitting-detector.js";

describe("splitting-detector", () => {
  describe("detectIndicators", () => {
    it("detects CONJUNCIONES + VERBOS_COMODIN in 'gestionar usuarios y permisos'", () => {
      const result = detectIndicators("gestionar usuarios y permisos");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("CONJUNCIONES");
      expect(categories).toContain("VERBOS_COMODIN");
    });

    it("detects SECUENCIA in 'antes de enviar, validar'", () => {
      const result = detectIndicators("antes de enviar, validar");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("SECUENCIA");
    });

    it("detects ALCANCE_EXPANDIDO + CONJUNCIONES in 'incluyendo exportacion a PDF y CSV'", () => {
      const result = detectIndicators("incluyendo exportacion a PDF y CSV");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("ALCANCE_EXPANDIDO");
      expect(categories).toContain("CONJUNCIONES");
    });

    it("detects OPCIONALIDAD in 'o bien A o bien B'", () => {
      const result = detectIndicators("o bien A o bien B");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("OPCIONALIDAD");
    });

    it("detects EXCEPCIONES in 'excepto cuando el usuario es admin'", () => {
      const result = detectIndicators("excepto cuando el usuario es admin");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("EXCEPCIONES");
    });

    it("detects indicators in English: 'manage users and permissions'", () => {
      const result = detectIndicators("manage users and permissions");
      expect(result.detected).toBe(true);
      const categories = result.indicators.map(i => i.category);
      expect(categories).toContain("CONJUNCIONES");
      expect(categories).toContain("VERBOS_COMODIN");
    });

    it("returns detected: false when no indicators found: 'Create a login page'", () => {
      const result = detectIndicators("Create a login page");
      expect(result.detected).toBe(false);
      expect(result.indicators).toEqual([]);
    });

    it("handles empty / null input gracefully", () => {
      expect(detectIndicators("").detected).toBe(false);
      expect(detectIndicators(null).detected).toBe(false);
      expect(detectIndicators(undefined).detected).toBe(false);
    });
  });

  describe("selectHeuristic", () => {
    it("selects outputs_first when VERBOS_COMODIN + CONJUNCIONES are present (higher priority wins)", () => {
      const indicators = [
        { category: "CONJUNCIONES", matchedPattern: "y", heuristic: "divide_by_example" },
        { category: "VERBOS_COMODIN", matchedPattern: "gestionar", heuristic: "outputs_first" }
      ];
      const result = selectHeuristic(indicators);
      expect(result.heuristic).toBe("outputs_first");
    });

    it("selects divide_by_example when only CONJUNCIONES present", () => {
      const indicators = [
        { category: "CONJUNCIONES", matchedPattern: "y", heuristic: "divide_by_example" }
      ];
      const result = selectHeuristic(indicators);
      expect(result.heuristic).toBe("divide_by_example");
    });

    it("selects base_case_first when EXCEPCIONES present", () => {
      const indicators = [
        { category: "EXCEPCIONES", matchedPattern: "excepto", heuristic: "base_case_first" }
      ];
      const result = selectHeuristic(indicators);
      expect(result.heuristic).toBe("base_case_first");
    });

    it("returns default heuristic for empty indicators", () => {
      const result = selectHeuristic([]);
      expect(result.heuristic).toBe("divide_by_example");
      expect(result.reason).toContain("default");
    });
  });

  describe("INDICATOR_CATEGORIES", () => {
    it("has exactly 6 categories", () => {
      expect(Object.keys(INDICATOR_CATEGORIES)).toHaveLength(6);
    });

    it("each category has patterns array and heuristic string", () => {
      for (const [, cat] of Object.entries(INDICATOR_CATEGORIES)) {
        expect(Array.isArray(cat.patterns)).toBe(true);
        expect(cat.patterns.length).toBeGreaterThan(0);
        expect(typeof cat.heuristic).toBe("string");
      }
    });
  });

  describe("HEURISTIC_DESCRIPTIONS", () => {
    it("has descriptions for all 9 heuristics", () => {
      expect(Object.keys(HEURISTIC_DESCRIPTIONS)).toHaveLength(9);
    });

    it("all values are non-empty strings", () => {
      for (const desc of Object.values(HEURISTIC_DESCRIPTIONS)) {
        expect(typeof desc).toBe("string");
        expect(desc.length).toBeGreaterThan(0);
      }
    });
  });
});
