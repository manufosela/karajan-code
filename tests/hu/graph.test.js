import { describe, expect, it } from "vitest";
import { topologicalSort, isStoryReady, getNextReadyStories } from "../../src/hu/graph.js";

describe("topologicalSort", () => {
  it("sorts linear chain A->B->C", () => {
    const stories = [
      { id: "C", blocked_by: ["B"] },
      { id: "B", blocked_by: ["A"] },
      { id: "A", blocked_by: [] }
    ];
    const sorted = topologicalSort(stories);
    expect(sorted).toEqual(["A", "B", "C"]);
  });

  it("sorts diamond A->B,C->D", () => {
    const stories = [
      { id: "D", blocked_by: ["B", "C"] },
      { id: "B", blocked_by: ["A"] },
      { id: "C", blocked_by: ["A"] },
      { id: "A", blocked_by: [] }
    ];
    const sorted = topologicalSort(stories);
    expect(sorted.indexOf("A")).toBeLessThan(sorted.indexOf("B"));
    expect(sorted.indexOf("A")).toBeLessThan(sorted.indexOf("C"));
    expect(sorted.indexOf("B")).toBeLessThan(sorted.indexOf("D"));
    expect(sorted.indexOf("C")).toBeLessThan(sorted.indexOf("D"));
  });

  it("handles no deps (all independent)", () => {
    const stories = [
      { id: "X", blocked_by: [] },
      { id: "Y", blocked_by: [] },
      { id: "Z", blocked_by: [] }
    ];
    const sorted = topologicalSort(stories);
    expect(sorted).toHaveLength(3);
    expect(new Set(sorted)).toEqual(new Set(["X", "Y", "Z"]));
  });

  it("throws on circular dependency", () => {
    const stories = [
      { id: "A", blocked_by: ["B"] },
      { id: "B", blocked_by: ["A"] }
    ];
    expect(() => topologicalSort(stories)).toThrow("Circular dependency");
  });

  it("throws on missing dependency", () => {
    const stories = [
      { id: "A", blocked_by: ["MISSING"] }
    ];
    expect(() => topologicalSort(stories)).toThrow("Dependency MISSING not found");
  });
});

describe("isStoryReady", () => {
  it("returns true when all deps done", () => {
    const story = { id: "B", blocked_by: ["A"] };
    const batch = { stories: [{ id: "A", status: "done" }, story] };
    expect(isStoryReady(story, batch)).toBe(true);
  });

  it("returns false when deps not done", () => {
    const story = { id: "B", blocked_by: ["A"] };
    const batch = { stories: [{ id: "A", status: "pending" }, story] };
    expect(isStoryReady(story, batch)).toBe(false);
  });

  it("returns true when no blocked_by", () => {
    const story = { id: "A", blocked_by: [] };
    expect(isStoryReady(story, { stories: [story] })).toBe(true);
  });

  it("returns true when blocked_by is undefined", () => {
    const story = { id: "A" };
    expect(isStoryReady(story, { stories: [story] })).toBe(true);
  });
});

describe("getNextReadyStories", () => {
  it("returns only certified + ready stories", () => {
    const batch = {
      stories: [
        { id: "A", status: "certified", blocked_by: [] },
        { id: "B", status: "certified", blocked_by: ["A"] },
        { id: "C", status: "pending", blocked_by: [] },
        { id: "D", status: "certified", blocked_by: [] }
      ]
    };
    const ready = getNextReadyStories(batch);
    const readyIds = ready.map(s => s.id);
    expect(readyIds).toContain("A");
    expect(readyIds).toContain("D");
    expect(readyIds).not.toContain("B"); // dep "A" not done
    expect(readyIds).not.toContain("C"); // not certified
  });
});
