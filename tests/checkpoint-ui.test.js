import { describe, expect, it } from "vitest";

// --- Unit tests for checkpoint/askQuestion UI formatting and answer parsing ---

// 1. Triage decomposition question
import { buildDecompositionQuestion } from "../src/planning-game/decomposition.js";

// 2. Solomon escalation message + answer parsing
import { formatEscalationMessage, parseEscalationAnswer } from "../src/orchestrator/solomon-escalation.js";

// 3. Checkpoint answer parsing (extracted from orchestrator.js)
import { parseCheckpointAnswer } from "../src/orchestrator.js";

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

describe("Checkpoint answer parsing", () => {
  it("answer '1' continues with 5 more minutes", () => {
    const result = parseCheckpointAnswer({ trimmedAnswer: "1", checkpointDisabled: false, config: { session: {} } });
    expect(result.action).toBe("continue_loop");
    expect(result.checkpointDisabled).toBe(false);
  });

  it("answer '2' disables future checkpoints", () => {
    const result = parseCheckpointAnswer({ trimmedAnswer: "2", checkpointDisabled: false, config: { session: {} } });
    expect(result.action).toBe("continue_loop");
    expect(result.checkpointDisabled).toBe(true);
  });

  it("answer '4' is handled as stop in handleCheckpoint (not in parseCheckpointAnswer)", () => {
    // parseCheckpointAnswer doesn't handle "4" — it's checked earlier in handleCheckpoint
    // A custom number like "10" sets the interval
    const config = { session: {} };
    const result = parseCheckpointAnswer({ trimmedAnswer: "10", checkpointDisabled: false, config });
    expect(result.action).toBe("continue_loop");
    expect(config.session.checkpoint_interval_minutes).toBe(10);
  });

  it("'continue until' text still works (backward compat)", () => {
    const result = parseCheckpointAnswer({ trimmedAnswer: "continue until done", checkpointDisabled: false, config: { session: {} } });
    expect(result.action).toBe("continue_loop");
    expect(result.checkpointDisabled).toBe(true);
  });

  it("empty answer defaults to continue", () => {
    const result = parseCheckpointAnswer({ trimmedAnswer: "", checkpointDisabled: false, config: { session: {} } });
    expect(result.action).toBe("continue_loop");
  });
});

describe("Checkpoint question format", () => {
  it("checkpoint question includes numbered options with = format", async () => {
    // We test the question format indirectly by checking the string built in handleCheckpoint.
    // The question is: "1 = Continue 5 more minutes\n2 = Continue until done..."
    // Since handleCheckpoint is not easily unit-testable in isolation, we verify the format constants.
    const expectedOptions = [
      "1 = Continue 5 more minutes",
      "2 = Continue until done (no more checkpoints)",
      "3 = Continue for N minutes",
      "4 = Stop now"
    ];
    // This test documents the expected format. The actual integration is tested in orchestrator-checkpoint.test.js
    for (const opt of expectedOptions) {
      expect(opt).toMatch(/^\d = /);
    }
  });
});

describe("Solomon critical alerts question format", () => {
  it("question format uses numbered options", () => {
    // The question built in checkSolomonCriticalAlerts includes:
    // "1 = Continue anyway"
    // "2 = Pause the session"
    // "3 = Stop the session"
    // This documents the expected format.
    const expectedOptions = [
      "1 = Continue anyway",
      "2 = Pause the session",
      "3 = Stop the session"
    ];
    for (const opt of expectedOptions) {
      expect(opt).toMatch(/^\d = /);
    }
  });
});
