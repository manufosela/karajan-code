import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "../src/prompts/planner.js";

describe("prompts/planner buildPlannerPrompt", () => {
  it("includes the task in the prompt", () => {
    const prompt = buildPlannerPrompt({ task: "Add user authentication" });
    expect(prompt).toContain("Add user authentication");
  });

  it("requests JSON output with required fields", () => {
    const prompt = buildPlannerPrompt({ task: "Refactor DB layer" });
    expect(prompt).toContain("approach");
    expect(prompt).toContain("steps");
    expect(prompt).toContain("risks");
    expect(prompt).toContain("outOfScope");
  });

  it("includes context when provided", () => {
    const prompt = buildPlannerPrompt({
      task: "Add caching",
      context: "We use Redis in production"
    });
    expect(prompt).toContain("Redis");
  });

  it("works without optional context", () => {
    const prompt = buildPlannerPrompt({ task: "Simple fix" });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("requests each step to be a single commit", () => {
    const prompt = buildPlannerPrompt({ task: "Big refactor" });
    expect(prompt.toLowerCase()).toContain("commit");
  });

  it("asks for structured JSON format", () => {
    const prompt = buildPlannerPrompt({ task: "Add feature" });
    expect(prompt).toContain("JSON");
  });
});
