import { describe, expect, it } from "vitest";

// --- Unit tests for checkpoint/askQuestion UI formatting and answer parsing ---

// 1. Triage decomposition question
import { buildDecompositionQuestion } from "../src/planning-game/decomposition.js";

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
