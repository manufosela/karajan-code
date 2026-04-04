import { describe, it, expect } from "vitest";
import {
  compressRoleOutput, estimateTokens, measureCompression
} from "../src/orchestrator/role-output-compressor.js";

describe("role-output-compressor", () => {
  describe("compressRoleOutput", () => {
    it("compresses researcher output", () => {
      const output = {
        affected_files: ["src/auth.js", "src/api.js"],
        patterns: ["middleware"],
        risks: ["breaking change"],
        constraints: ["keep API compat"]
      };
      const compressed = compressRoleOutput("researcher", output);
      expect(compressed).toContain("src/auth.js");
      expect(compressed).toContain("breaking change");
      expect(compressed).toContain("middleware");
    });

    it("compresses architect output", () => {
      const output = {
        architecture: {
          type: "monolith",
          layers: ["API", "Service", "DB"],
          patterns: ["Repository"],
          dataModel: { entities: ["User", "Task"] }
        },
        verdict: "ready"
      };
      const compressed = compressRoleOutput("architect", output);
      expect(compressed).toContain("monolith");
      expect(compressed).toContain("API → Service → DB");
      expect(compressed).toContain("User, Task");
      expect(compressed).toContain("Verdict: ready");
    });

    it("compresses planner output to numbered steps", () => {
      const output = {
        plan: "Some intro prose.\n1. Init project\n2. Add routes\n3. Add tests\nSome outro."
      };
      const compressed = compressRoleOutput("planner", output);
      expect(compressed).toContain("1. Init project");
      expect(compressed).toContain("2. Add routes");
      expect(compressed).toContain("3. Add tests");
      expect(compressed).not.toContain("Some intro prose");
    });

    it("compresses reviewer rejection", () => {
      const output = {
        approved: false,
        blocking_issues: [
          { severity: "high", file: "app.js", line: 42, description: "missing auth", suggested_fix: "add middleware" }
        ]
      };
      const compressed = compressRoleOutput("reviewer", output);
      expect(compressed).toContain("[high]");
      expect(compressed).toContain("app.js:42");
      expect(compressed).toContain("missing auth");
      expect(compressed).toContain("add middleware");
    });

    it("compresses reviewer approval", () => {
      const output = { approved: true, summary: "Looks good" };
      const compressed = compressRoleOutput("reviewer", output);
      expect(compressed).toContain("Approved");
    });

    it("compresses tester output", () => {
      const output = {
        verdict: "fail",
        coverage: { overall: 65 },
        missing_scenarios: ["edge case a", "edge case b"],
        quality_issues: ["weak assertions"]
      };
      const compressed = compressRoleOutput("tester", output);
      expect(compressed).toContain("Verdict: fail");
      expect(compressed).toContain("65%");
      expect(compressed).toContain("edge case");
    });

    it("compresses security output with grouped severities", () => {
      const output = {
        verdict: "fail",
        vulnerabilities: [
          { severity: "critical", file: "db.js", line: 10, description: "SQL injection" },
          { severity: "high", file: "api.js", description: "missing CSRF" }
        ]
      };
      const compressed = compressRoleOutput("security", output);
      expect(compressed).toContain("critical:");
      expect(compressed).toContain("high:");
      expect(compressed).toContain("SQL injection");
    });

    it("returns 'no vulnerabilities' when security passes", () => {
      const output = { verdict: "pass", vulnerabilities: [] };
      const compressed = compressRoleOutput("security", output);
      expect(compressed).toContain("no vulnerabilities");
    });

    it("falls back to default compressor for unknown role", () => {
      const output = { data: "some content" };
      const compressed = compressRoleOutput("unknown_role", output);
      expect(compressed).toContain("some content");
    });

    it("truncates very long strings in default", () => {
      const longStr = "x".repeat(5000);
      const compressed = compressRoleOutput("unknown_role", longStr);
      expect(compressed.length).toBeLessThan(longStr.length);
      expect(compressed).toContain("truncated");
    });

    it("handles null/undefined gracefully", () => {
      expect(compressRoleOutput("researcher", null)).toBe(null);
      expect(compressRoleOutput("unknown", undefined)).toBe("");
    });
  });

  describe("estimateTokens", () => {
    it("estimates roughly chars/4", () => {
      expect(estimateTokens("1234567890abcdef")).toBe(4);
    });

    it("returns 0 for empty", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens(null)).toBe(0);
    });
  });

  describe("measureCompression", () => {
    it("computes savings", () => {
      const original = "x".repeat(1000); // 250 tokens
      const compressed = "x".repeat(200); // 50 tokens
      const result = measureCompression(original, compressed);
      expect(result.originalTokens).toBe(250);
      expect(result.compressedTokens).toBe(50);
      expect(result.savedTokens).toBe(200);
      expect(result.savedPct).toBe(80);
    });

    it("handles object input", () => {
      const result = measureCompression({ a: "x".repeat(500) }, "short");
      expect(result.savedTokens).toBeGreaterThan(0);
    });
  });
});
