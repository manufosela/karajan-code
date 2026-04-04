import { describe, it, expect } from "vitest";
import {
  createQueue, addEntry, addEntries, deduplicate, prioritize,
  formatForCoder, filterByCategory, hasBlockingIssues, countByCategory,
  clear, serialize, deserialize
} from "../src/orchestrator/feedback-queue.js";

describe("feedback-queue", () => {
  describe("createQueue", () => {
    it("creates an empty queue", () => {
      const q = createQueue();
      expect(q.entries).toEqual([]);
    });
  });

  describe("addEntry", () => {
    it("adds a valid entry with defaults", () => {
      const q = createQueue();
      addEntry(q, { description: "test issue" });
      expect(q.entries).toHaveLength(1);
      expect(q.entries[0].source).toBe("unknown");
      expect(q.entries[0].severity).toBe("medium");
      expect(q.entries[0].category).toBe("other");
    });

    it("ignores entries without description", () => {
      const q = createQueue();
      addEntry(q, { source: "reviewer" });
      expect(q.entries).toHaveLength(0);
    });

    it("preserves all optional fields", () => {
      const q = createQueue();
      addEntry(q, {
        source: "reviewer", severity: "high", category: "security",
        description: "SQL injection", file: "api.js", line: 42,
        suggestedFix: "use prepared statements", id: "R-1", iteration: 2
      });
      expect(q.entries[0]).toMatchObject({
        source: "reviewer", severity: "high", category: "security",
        file: "api.js", line: 42, iteration: 2
      });
    });
  });

  describe("addEntries", () => {
    it("adds multiple entries", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "a", source: "reviewer" },
        { description: "b", source: "tester" }
      ]);
      expect(q.entries).toHaveLength(2);
    });
  });

  describe("deduplicate", () => {
    it("removes duplicates keeping most severe", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "missing auth", source: "reviewer", severity: "high" },
        { description: "missing auth", source: "reviewer", severity: "critical" }
      ]);
      deduplicate(q);
      expect(q.entries).toHaveLength(1);
      expect(q.entries[0].severity).toBe("critical");
    });

    it("keeps entries from different sources", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "missing test", source: "reviewer", severity: "high" },
        { description: "missing test", source: "tester", severity: "high" }
      ]);
      deduplicate(q);
      expect(q.entries).toHaveLength(2);
    });
  });

  describe("prioritize", () => {
    it("sorts by category then severity", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "style", category: "style", severity: "low" },
        { description: "sec1", category: "security", severity: "critical" },
        { description: "sec2", category: "security", severity: "high" },
        { description: "bug", category: "correctness", severity: "high" }
      ]);
      prioritize(q);
      expect(q.entries[0].description).toBe("sec1");
      expect(q.entries[1].description).toBe("sec2");
      expect(q.entries[2].description).toBe("bug");
      expect(q.entries[3].description).toBe("style");
    });
  });

  describe("formatForCoder", () => {
    it("returns empty string for empty queue", () => {
      expect(formatForCoder(createQueue())).toBe("");
    });

    it("formats entries as numbered list", () => {
      const q = createQueue();
      addEntry(q, {
        source: "reviewer", severity: "high", category: "security",
        description: "Missing CSRF", file: "app.js", line: 10,
        suggestedFix: "add csurf middleware"
      });
      const output = formatForCoder(q);
      expect(output).toContain("1. [reviewer:high:security] (app.js:10)");
      expect(output).toContain("Missing CSRF");
      expect(output).toContain("Fix: add csurf middleware");
    });
  });

  describe("filterByCategory", () => {
    it("returns only matching category", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "a", category: "security" },
        { description: "b", category: "style" },
        { description: "c", category: "security" }
      ]);
      const sec = filterByCategory(q, "security");
      expect(sec.entries).toHaveLength(2);
    });
  });

  describe("hasBlockingIssues", () => {
    it("returns true when critical or high severity present", () => {
      const q = createQueue();
      addEntry(q, { description: "x", severity: "high" });
      expect(hasBlockingIssues(q)).toBe(true);
    });

    it("returns false for only medium/low", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "x", severity: "medium" },
        { description: "y", severity: "low" }
      ]);
      expect(hasBlockingIssues(q)).toBe(false);
    });
  });

  describe("countByCategory", () => {
    it("counts entries per category", () => {
      const q = createQueue();
      addEntries(q, [
        { description: "a", category: "security" },
        { description: "b", category: "security" },
        { description: "c", category: "tests" }
      ]);
      expect(countByCategory(q)).toEqual({ security: 2, tests: 1 });
    });
  });

  describe("clear", () => {
    it("empties the queue", () => {
      const q = createQueue();
      addEntry(q, { description: "x" });
      clear(q);
      expect(q.entries).toEqual([]);
    });
  });

  describe("serialize/deserialize", () => {
    it("round-trips queue state", () => {
      const q = createQueue();
      addEntry(q, { description: "test", source: "reviewer", severity: "high" });
      const str = serialize(q);
      const restored = deserialize(str);
      expect(restored.entries).toHaveLength(1);
      expect(restored.entries[0].description).toBe("test");
    });

    it("handles empty/invalid input", () => {
      expect(deserialize(null).entries).toEqual([]);
      expect(deserialize("garbage").entries).toEqual([]);
      expect(deserialize("{}").entries).toEqual([]);
    });
  });
});
