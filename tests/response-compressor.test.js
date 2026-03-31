import { describe, it, expect } from "vitest";
import { compressResponse, compactStringify } from "../src/mcp/response-compressor.js";

describe("response-compressor", () => {
  describe("compressResponse", () => {
    it("strips verbose fields from array items", () => {
      const data = [
        { id: "1", title: "Task A", descriptionStructured: [{ role: "user" }], implementationPlan: { steps: [] } },
        { id: "2", title: "Task B", acceptanceCriteriaStructured: [{ given: "x" }], workCycles: [] }
      ];
      const result = compressResponse(data);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "1", title: "Task A" });
      expect(result[1]).toEqual({ id: "2", title: "Task B" });
    });

    it("keeps verbose fields in single objects (non-array)", () => {
      const data = {
        id: "1",
        title: "Task A",
        descriptionStructured: [{ role: "user" }],
        implementationPlan: { steps: ["a", "b"] }
      };
      const result = compressResponse(data);
      expect(result.descriptionStructured).toBeDefined();
      expect(result.implementationPlan).toBeDefined();
      expect(result.title).toBe("Task A");
    });

    it("truncates arrays at 20 items with a note", () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `Item ${i}` }));
      const result = compressResponse(items);
      expect(result).toHaveLength(21); // 20 items + 1 truncation note
      expect(result[20]).toEqual({ _truncated: true, _total: 25, _showing: 20 });
    });

    it("truncates commits to last 5", () => {
      const commits = Array.from({ length: 8 }, (_, i) => ({ hash: `abc${i}`, message: `commit ${i}` }));
      const data = { ok: true, commits };
      const result = compressResponse(data);
      expect(result.commits).toHaveLength(6); // 1 note + 5 commits
      expect(result.commits[0]).toEqual({ _note: "3 earlier items omitted" });
      expect(result.commits[5].hash).toBe("abc7");
    });

    it("truncates findings to first 10", () => {
      const findings = Array.from({ length: 15 }, (_, i) => ({ rule: `rule-${i}`, severity: "major" }));
      const data = { ok: true, findings };
      const result = compressResponse(data);
      expect(result.findings).toHaveLength(11); // 10 items + 1 note
      expect(result.findings[10]).toEqual({ _note: "... and 5 more" });
    });

    it("truncates blocking_issues to first 10", () => {
      const blocking_issues = Array.from({ length: 12 }, (_, i) => ({ issue: `issue-${i}` }));
      const data = { ok: true, blocking_issues };
      const result = compressResponse(data);
      expect(result.blocking_issues).toHaveLength(11);
      expect(result.blocking_issues[10]).toEqual({ _note: "... and 2 more" });
    });

    it("strips ALWAYS_STRIP fields from all responses", () => {
      const data = {
        id: "1",
        firebaseId: "fb-123",
        cardType: "task",
        group: "grp",
        createdBy: "user1",
        updatedBy: "user2",
        _instance: "inst",
        title: "Keep me"
      };
      const result = compressResponse(data);
      expect(result).toEqual({ id: "1", title: "Keep me" });
    });

    it("strips ALWAYS_STRIP fields from array items too", () => {
      const data = [{ id: "1", firebaseId: "fb-123", title: "Task" }];
      const result = compressResponse(data);
      expect(result[0].firebaseId).toBeUndefined();
      expect(result[0].title).toBe("Task");
    });

    it("returns null/undefined input unchanged", () => {
      expect(compressResponse(null)).toBeNull();
      expect(compressResponse(undefined)).toBeUndefined();
      expect(compressResponse(0)).toBe(0);
      expect(compressResponse("hello")).toBe("hello");
    });

    it("recursively compresses nested objects", () => {
      const data = {
        ok: true,
        nested: {
          firebaseId: "strip-me",
          title: "Keep",
          items: [
            { id: "1", descriptionStructured: [{ role: "x" }], raw: "big text" }
          ]
        }
      };
      const result = compressResponse(data);
      expect(result.nested.firebaseId).toBeUndefined();
      expect(result.nested.title).toBe("Keep");
      expect(result.nested.items[0].descriptionStructured).toBeUndefined();
      expect(result.nested.items[0].raw).toBeUndefined();
      expect(result.nested.items[0].id).toBe("1");
    });

    it("never removes vital fields (ok, summary, approved, error)", () => {
      const data = {
        ok: true,
        summary: "All good",
        approved: true,
        error: null,
        firebaseId: "strip-me"
      };
      const result = compressResponse(data);
      expect(result.ok).toBe(true);
      expect(result.summary).toBe("All good");
      expect(result.approved).toBe(true);
      expect(result.error).toBeNull();
      expect(result.firebaseId).toBeUndefined();
    });

    it("handles empty arrays without error", () => {
      expect(compressResponse([])).toEqual([]);
      expect(compressResponse({ items: [] })).toEqual({ items: [] });
    });

    it("does not truncate commits when 5 or fewer", () => {
      const commits = [{ hash: "a" }, { hash: "b" }];
      const result = compressResponse({ commits });
      expect(result.commits).toEqual([{ hash: "a" }, { hash: "b" }]);
    });

    it("does not truncate findings when 10 or fewer", () => {
      const findings = Array.from({ length: 10 }, (_, i) => ({ rule: `r${i}` }));
      const result = compressResponse({ findings });
      expect(result.findings).toHaveLength(10);
    });
  });

  describe("compactStringify", () => {
    it("produces no indentation", () => {
      const data = { ok: true, items: [1, 2, 3] };
      const result = compactStringify(data);
      expect(result).toBe('{"ok":true,"items":[1,2,3]}');
      expect(result).not.toContain("\n");
      expect(result).not.toContain("  ");
    });

    it("handles null and primitives", () => {
      expect(compactStringify(null)).toBe("null");
      expect(compactStringify(42)).toBe("42");
      expect(compactStringify("test")).toBe('"test"');
    });
  });
});
