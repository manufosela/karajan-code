import { describe, expect, it } from "vitest";

// --- Unit tests for checkpoint/askQuestion UI formatting and answer parsing ---

// 1. Triage decomposition question
import { buildDecompositionQuestion } from "../src/planning-game/decomposition.js";

// 2. Solomon escalation message + answer parsing
import { formatEscalationMessage, parseEscalationAnswer } from "../src/orchestrator/solomon-escalation.js";

describe("Triage decomposition question UI", () => {
  it("includes numbered options in the question", () => {
    const subtasks = ["Implement MySQL parser", "Implement CSV parser", "Add integration tests"];
    const question = buildDecompositionQuestion(subtasks, "KJC-TSK-0042");

    expect(question).toContain("Reply: yes / no");
    expect(question).toContain("sequential chain");
  });

  it("lists all subtasks with numbers", () => {
    const subtasks = ["Task A", "Task B"];
    const question = buildDecompositionQuestion(subtasks, "TSK-001");

    expect(question).toContain("1. Task A");
    expect(question).toContain("2. Task B");
  });
});

describe("Solomon escalation question UI", () => {
  it("includes numbered options in the escalation message", () => {
    const message = formatEscalationMessage({ stage: "reviewer", history: [] });

    expect(message).toContain("1. Accept coder's work as-is");
    expect(message).toContain("2. Retry with reviewer's feedback");
    expect(message).toContain("3. Stop the session");
  });

  it("includes reviewer feedback in the escalation message", () => {
    const message = formatEscalationMessage({
      stage: "reviewer",
      history: [{ agent: "reviewer", feedback: "Missing error handling" }]
    });

    expect(message).toContain("Missing error handling");
    expect(message).toContain("--- Conflict: reviewer ---");
  });
});

describe("Solomon escalation answer parsing", () => {
  it("answer '1' maps to accept (continue)", () => {
    const result = parseEscalationAnswer("1");
    expect(result.action).toBe("continue");
    expect(result.humanGuidance).toContain("Accept");
  });

  it("answer '2' maps to retry (continue)", () => {
    const result = parseEscalationAnswer("2");
    expect(result.action).toBe("continue");
    expect(result.humanGuidance).toContain("Retry");
  });

  it("answer '3' maps to stop", () => {
    const result = parseEscalationAnswer("3");
    expect(result.action).toBe("stop");
  });

  it("'yes' still works (backward compat)", () => {
    const result = parseEscalationAnswer("yes");
    expect(result.action).toBe("continue");
  });

  it("'si' still works (backward compat)", () => {
    const result = parseEscalationAnswer("sí");
    expect(result.action).toBe("continue");
  });

  it("'stop' still works (backward compat)", () => {
    const result = parseEscalationAnswer("stop");
    expect(result.action).toBe("stop");
  });

  it("free text is treated as human guidance", () => {
    const result = parseEscalationAnswer("Please focus on the error handling in utils.js");
    expect(result.action).toBe("continue");
    expect(result.humanGuidance).toBe("Please focus on the error handling in utils.js");
  });

  it("null answer returns null", () => {
    const result = parseEscalationAnswer(null);
    expect(result).toBeNull();
  });

  it("empty string returns null", () => {
    const result = parseEscalationAnswer("");
    expect(result).toBeNull();
  });
});
