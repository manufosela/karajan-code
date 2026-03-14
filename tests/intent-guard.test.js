import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  compileIntentPatterns,
  INTENT_PATTERNS,
} from "../src/guards/intent-guard.js";

describe("INTENT_PATTERNS", () => {
  it("has at least 5 built-in patterns", () => {
    expect(INTENT_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  it("all built-in patterns have required fields", () => {
    for (const p of INTENT_PATTERNS) {
      expect(p.id).toBeTruthy();
      expect(Array.isArray(p.keywords)).toBe(true);
      expect(p.keywords.length).toBeGreaterThan(0);
      expect(p.taskType).toBeTruthy();
      expect(p.level).toBeTruthy();
      expect(typeof p.confidence).toBe("number");
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("compileIntentPatterns", () => {
  it("returns built-in patterns when no custom config", () => {
    const patterns = compileIntentPatterns({});
    expect(patterns).toHaveLength(INTENT_PATTERNS.length);
  });

  it("prepends custom patterns before built-in", () => {
    const config = {
      intent: {
        patterns: [
          { id: "custom-1", keywords: ["deploy"], taskType: "infra", confidence: 0.9 },
        ],
      },
    };
    const patterns = compileIntentPatterns(config);
    expect(patterns).toHaveLength(INTENT_PATTERNS.length + 1);
    expect(patterns[0].id).toBe("custom-1");
  });

  it("defaults missing fields in custom patterns", () => {
    const config = {
      intent: {
        patterns: [{ keywords: ["foo"] }],
      },
    };
    const patterns = compileIntentPatterns(config);
    const custom = patterns[0];
    expect(custom.id).toBe("custom-intent");
    expect(custom.taskType).toBe("sw");
    expect(custom.level).toBe("simple");
    expect(custom.confidence).toBe(0.85);
  });

  it("validates taskType against VALID_TASK_TYPES, falls back to sw", () => {
    const config = {
      intent: {
        patterns: [{ keywords: ["x"], taskType: "invalid-type" }],
      },
    };
    const patterns = compileIntentPatterns(config);
    expect(patterns[0].taskType).toBe("sw");
  });
});

describe("classifyIntent", () => {
  it("classifies documentation task -> doc / trivial", () => {
    const result = classifyIntent("Update the README with new API docs");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("doc");
    expect(result.level).toBe("trivial");
    expect(result.patternId).toBe("doc-readme");
  });

  it("classifies test-addition task -> add-tests / simple", () => {
    const result = classifyIntent("Add unit tests for the user service");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("add-tests");
    expect(result.level).toBe("simple");
    expect(result.patternId).toBe("add-tests");
  });

  it("classifies refactoring task -> refactor / simple", () => {
    const result = classifyIntent("Refactor the payment module to extract helper functions");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("refactor");
    expect(result.patternId).toBe("refactor");
  });

  it("classifies infra/devops task -> infra / simple", () => {
    const result = classifyIntent("Update the Dockerfile and add GitHub Actions CI/CD");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("infra");
    expect(result.patternId).toBe("infra-devops");
  });

  it("classifies trivial fix -> sw / trivial", () => {
    const result = classifyIntent("Fix typo in error message");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("sw");
    expect(result.level).toBe("trivial");
    expect(result.patternId).toBe("trivial-fix");
  });

  it("returns classified: false for ambiguous tasks", () => {
    const result = classifyIntent("Implement user authentication with OAuth2 and JWT tokens");
    expect(result.classified).toBe(false);
  });

  it("returns classified: false for null/undefined/empty input", () => {
    expect(classifyIntent(null).classified).toBe(false);
    expect(classifyIntent(undefined).classified).toBe(false);
    expect(classifyIntent("").classified).toBe(false);
  });

  it("is case-insensitive", () => {
    const result = classifyIntent("UPDATE THE README FILE");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("doc");
  });

  it("respects custom confidence_threshold from config", () => {
    // With threshold higher than pattern confidence, classification fails
    const config = { guards: { intent: { confidence_threshold: 0.99 } } };
    const result = classifyIntent("Fix typo in comment", config);
    // "typo" matches trivial-fix (confidence 0.9), but threshold is 0.99
    expect(result.classified).toBe(false);
  });

  it("custom patterns take priority over built-in", () => {
    const config = {
      guards: {
        intent: {
          patterns: [
            { id: "my-doc", keywords: ["readme"], taskType: "infra", confidence: 0.95 },
          ],
        },
      },
    };
    const result = classifyIntent("Update the README", config);
    expect(result.classified).toBe(true);
    expect(result.patternId).toBe("my-doc");
    expect(result.taskType).toBe("infra"); // custom overrides built-in doc classification
  });

  it("classifies when any single keyword matches", () => {
    // "unit test" is one of the add-tests keywords
    const result = classifyIntent("Add a unit test for the parser");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("add-tests");
    expect(result.confidence).toBe(0.9);
  });

  it("returns confidence value in result when classified", () => {
    const result = classifyIntent("Fix the typo in the lint configuration");
    if (result.classified) {
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
