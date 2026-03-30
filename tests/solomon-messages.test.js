import { describe, it, expect } from "vitest";
import { formatEscalationMessage } from "../src/orchestrator/solomon-escalation.js";

describe("formatEscalationMessage", () => {
  it("produces readable text from raw history", () => {
    const conflict = {
      stage: "reviewer",
      solomonReason: "Solomon error: timeout",
      history: [
        { agent: "reviewer", feedback: "R-1: The change only deletes code without replacing it" }
      ],
      iterationCount: 3,
      maxIterations: 3
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("Conflict: reviewer");
    expect(result).toContain("Reviewer feedback:");
    expect(result).toContain("[reviewer] R-1: The change only deletes code without replacing it");
    expect(result).toContain("Solomon could not resolve the conflict: Solomon error: timeout");
    expect(result).toContain("Iteration 3/3");
    expect(result).toContain("1. Accept coder's work as-is");
    expect(result).toContain("2. Retry with reviewer's feedback");
    expect(result).toContain("3. Stop the session");
    expect(result).toContain("How should we proceed?");
  });

  it("does not contain JSON artifacts in the formatted output", () => {
    const conflict = {
      stage: "reviewer",
      history: [
        { agent: "reviewer", feedback: "R-1: Missing error handling\nR-2: No tests added" }
      ]
    };

    const result = formatEscalationMessage(conflict);

    // No JSON artifacts (curly braces, or JSON key syntax)
    expect(result).not.toMatch(/[{}]/);
    expect(result).not.toContain('"agent"');
    expect(result).not.toContain('"feedback"');
    expect(result).not.toContain("JSON");
    expect(result).not.toContain("stringify");
  });

  it("lists multiple feedback entries clearly", () => {
    const conflict = {
      stage: "reviewer",
      history: [
        { agent: "reviewer", feedback: "R-1: Missing error handling" },
        { agent: "coder", feedback: "Applied fix for R-1" },
        { agent: "reviewer", feedback: "R-2: No tests for the new function" }
      ]
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("[reviewer] R-1: Missing error handling");
    expect(result).toContain("[coder] Applied fix for R-1");
    expect(result).toContain("[reviewer] R-2: No tests for the new function");
  });

  it("handles multi-line feedback as bullet points", () => {
    const conflict = {
      stage: "reviewer",
      history: [
        { agent: "reviewer", feedback: "R-1: Missing error handling\nR-2: No tests added\nR-3: Unused import" }
      ]
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("[reviewer]");
    expect(result).toContain("- R-1: Missing error handling");
    expect(result).toContain("- R-2: No tests added");
    expect(result).toContain("- R-3: Unused import");
  });

  it("handles missing feedback fields gracefully", () => {
    const conflict = {
      stage: "max_iterations",
      history: [
        { agent: "pipeline" },
        {},
        null
      ]
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("Conflict: max_iterations");
    expect(result).toContain("[pipeline] No feedback provided");
    expect(result).toContain("[unknown] No feedback provided");
    expect(result).toContain("Options:");
  });

  it("handles empty conflict gracefully", () => {
    const result = formatEscalationMessage({});

    expect(result).toContain("Conflict: unknown");
    expect(result).toContain("Options:");
    expect(result).toContain("How should we proceed?");
    // No reviewer feedback section when history is empty
    expect(result).not.toContain("Reviewer feedback:");
  });

  it("handles null/undefined input gracefully", () => {
    const resultNull = formatEscalationMessage(null);
    expect(resultNull).toContain("Conflict: unknown");
    expect(resultNull).toContain("Options:");

    const resultUndefined = formatEscalationMessage(undefined);
    expect(resultUndefined).toContain("Conflict: unknown");
    expect(resultUndefined).toContain("Options:");
  });

  it("handles solomonReason without history", () => {
    const conflict = {
      stage: "reviewer",
      solomonReason: "Solomon escalated to human",
      history: []
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("Solomon could not resolve the conflict: Solomon escalated to human");
    expect(result).not.toContain("Reviewer feedback:");
  });

  it("includes iteration context when provided", () => {
    const conflict = {
      stage: "reviewer",
      iterationCount: 5,
      maxIterations: 10,
      history: []
    };

    const result = formatEscalationMessage(conflict);

    expect(result).toContain("Iteration 5/10");
  });

  it("omits iteration context when not provided", () => {
    const conflict = {
      stage: "reviewer",
      history: [{ agent: "reviewer", feedback: "some issue" }]
    };

    const result = formatEscalationMessage(conflict);

    expect(result).not.toContain("Iteration ");
  });
});
