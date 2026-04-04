import { describe, it, expect } from "vitest";
import {
  extractFileHints, detectCategory, detectSeverity,
  generateActionPlan, enrichEntry, enrichQueue, formatEnrichedForCoder
} from "../src/orchestrator/feedback-enrichment.js";

describe("feedback-enrichment", () => {
  describe("extractFileHints", () => {
    it("extracts explicit file paths", () => {
      const hints = extractFileHints("Fix packages/server/auth.js and src/routes/users.ts");
      expect(hints).toContain("packages/server/auth.js");
      expect(hints).toContain("src/routes/users.ts");
    });

    it("extracts directory references", () => {
      const hints = extractFileHints("Missing tests in packages/server/tests");
      expect(hints.some(h => h.includes("packages/server"))).toBe(true);
    });

    it("returns empty for text without paths", () => {
      expect(extractFileHints("generic description")).toEqual([]);
    });

    it("handles multiple file types", () => {
      const hints = extractFileHints("See app.py and config.yml and style.css");
      expect(hints.length).toBeGreaterThan(0);
    });
  });

  describe("detectCategory", () => {
    it("detects security", () => {
      expect(detectCategory("SQL injection vulnerability")).toBe("security");
      expect(detectCategory("XSS in comment form")).toBe("security");
      expect(detectCategory("CSRF missing")).toBe("security");
      expect(detectCategory("exposed secret in config")).toBe("security");
    });

    it("detects tests", () => {
      expect(detectCategory("missing test coverage")).toBe("tests");
      expect(detectCategory("assert statements incomplete")).toBe("tests");
    });

    it("detects correctness", () => {
      expect(detectCategory("function returns wrong value")).toBe("correctness");
      expect(detectCategory("crash on empty input")).toBe("correctness");
    });

    it("detects style", () => {
      expect(detectCategory("inconsistent naming")).toBe("style");
      expect(detectCategory("formatting issue")).toBe("style");
    });

    it("defaults to other", () => {
      expect(detectCategory("some random feedback")).toBe("other");
    });
  });

  describe("detectSeverity", () => {
    it("uses existing severity if provided", () => {
      expect(detectSeverity("whatever", "high")).toBe("high");
    });

    it("detects critical keywords", () => {
      expect(detectSeverity("critical production risk")).toBe("critical");
      expect(detectSeverity("blocker issue")).toBe("critical");
    });

    it("detects high from security keywords", () => {
      expect(detectSeverity("security vulnerability found")).toBe("high");
    });

    it("detects low", () => {
      expect(detectSeverity("minor cosmetic nitpick")).toBe("low");
    });

    it("defaults to medium", () => {
      expect(detectSeverity("some issue")).toBe("medium");
    });
  });

  describe("generateActionPlan", () => {
    it("uses provided file and line", () => {
      const plan = generateActionPlan({
        file: "app.js", line: 42, description: "fix this", category: "correctness"
      });
      expect(plan[0]).toContain("app.js");
      expect(plan[0]).toContain("42");
    });

    it("uses extracted hints when no file provided", () => {
      const plan = generateActionPlan({
        description: "problem in packages/server/auth.js", category: "security"
      });
      expect(plan[0]).toContain("packages/server/auth.js");
    });

    it("falls back to grep suggestion", () => {
      const plan = generateActionPlan({
        description: "generic issue", category: "correctness"
      });
      expect(plan[0]).toContain("grep");
    });

    it("adds security-specific steps", () => {
      const plan = generateActionPlan({
        description: "SQL injection", category: "security"
      });
      expect(plan.some(s => s.includes("security fix"))).toBe(true);
    });

    it("adds test-specific steps for tests category", () => {
      const plan = generateActionPlan({
        description: "missing coverage", category: "tests"
      });
      expect(plan.some(s => s.includes("test"))).toBe(true);
      expect(plan.some(s => s.includes("Run tests"))).toBe(true);
    });

    it("includes suggested fix when provided", () => {
      const plan = generateActionPlan({
        description: "issue", category: "correctness",
        suggestedFix: "use prepared statements"
      });
      expect(plan.some(s => s.includes("prepared statements"))).toBe(true);
    });
  });

  describe("enrichEntry", () => {
    it("adds category, severity, fileHints, actionPlan", () => {
      const enriched = enrichEntry({
        description: "SQL injection in packages/api/db.js",
        source: "reviewer"
      });
      expect(enriched.category).toBe("security");
      expect(enriched.severity).toBe("high");
      expect(enriched.fileHints).toContain("packages/api/db.js");
      expect(enriched.actionPlan).toBeDefined();
      expect(enriched.actionPlan.length).toBeGreaterThan(0);
    });

    it("preserves existing fields", () => {
      const enriched = enrichEntry({
        source: "tester", severity: "critical", category: "tests",
        description: "coverage below 80%", file: "src/utils.js"
      });
      expect(enriched.severity).toBe("critical");
      expect(enriched.category).toBe("tests");
      expect(enriched.fileHints).toEqual(["src/utils.js"]);
    });
  });

  describe("enrichQueue", () => {
    it("enriches all entries in the queue", () => {
      const queue = {
        entries: [
          { description: "XSS in admin panel", source: "reviewer" },
          { description: "missing test in src/auth.js", source: "tester" }
        ]
      };
      enrichQueue(queue);
      expect(queue.entries[0].category).toBe("security");
      expect(queue.entries[1].category).toBe("tests");
      expect(queue.entries[1].fileHints).toContain("src/auth.js");
    });
  });

  describe("formatEnrichedForCoder", () => {
    it("returns empty string for empty array", () => {
      expect(formatEnrichedForCoder([])).toBe("");
    });

    it("formats enriched entries as sections", () => {
      const entries = [enrichEntry({
        description: "SQL injection in db.js",
        source: "reviewer"
      })];
      const output = formatEnrichedForCoder(entries);
      expect(output).toContain("### Issue 1:");
      expect(output).toContain("security");
      expect(output).toContain("**Location hints:**");
      expect(output).toContain("**Action plan:**");
    });
  });
});
