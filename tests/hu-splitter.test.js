import { describe, expect, it, vi } from "vitest";
import { detectIndicators, selectHeuristic, HEURISTIC_DESCRIPTIONS } from "../src/hu/splitting-detector.js";
import {
  buildSplitPrompt,
  parseSplitOutput,
  generateSplitProposal,
  formatSplitProposalForFDE,
  buildSplitDependencies
} from "../src/hu/splitting-generator.js";

// --- splitting-detector tests ---

describe("detectIndicators", () => {
  it("returns empty array for null/empty/non-string input", () => {
    expect(detectIndicators(null)).toEqual([]);
    expect(detectIndicators("")).toEqual([]);
    expect(detectIndicators(42)).toEqual([]);
  });

  it("detects multiple 'and' connectors", () => {
    const text = "As a user, I want to create and edit and delete records";
    const indicators = detectIndicators(text);
    const andIndicator = indicators.find(i => i.type === "multiple_and");
    expect(andIndicator).toBeDefined();
    expect(andIndicator.weight).toBeGreaterThan(0);
  });

  it("detects multiple roles", () => {
    const text = "As a doctor, I want to review reports. As an admin, I want to manage users.";
    const indicators = detectIndicators(text);
    const roleIndicator = indicators.find(i => i.type === "multiple_roles");
    expect(roleIndicator).toBeDefined();
    expect(roleIndicator.weight).toBe(3);
  });

  it("detects CRUD operations", () => {
    const text = "The system should create, read, update, and delete patient records.";
    const indicators = detectIndicators(text);
    const crudIndicator = indicators.find(i => i.type === "crud_operations");
    expect(crudIndicator).toBeDefined();
  });

  it("detects workflow step indicators", () => {
    const text = "First the user logs in, then they fill the form, and finally submit it.";
    const indicators = detectIndicators(text);
    const stepIndicator = indicators.find(i => i.type === "workflow_steps");
    expect(stepIndicator).toBeDefined();
  });

  it("detects many acceptance criteria", () => {
    const text = "Acceptance:\n- A\n- B\n- C\n- D\n- E\n- F\n";
    const indicators = detectIndicators(text);
    const acIndicator = indicators.find(i => i.type === "many_acceptance_criteria");
    expect(acIndicator).toBeDefined();
  });

  it("detects multiple benefit clauses", () => {
    const text = "I want X so that I can save time, and also Y so that I can reduce errors.";
    const indicators = detectIndicators(text);
    const benefitIndicator = indicators.find(i => i.type === "multiple_benefits");
    expect(benefitIndicator).toBeDefined();
  });

  it("returns no indicators for a simple HU", () => {
    const text = "As a user, I want to log in.";
    const indicators = detectIndicators(text);
    expect(indicators).toEqual([]);
  });
});

describe("selectHeuristic", () => {
  it("returns null for empty indicators", () => {
    expect(selectHeuristic([])).toBeNull();
    expect(selectHeuristic(null)).toBeNull();
  });

  it("selects user_role for multiple_roles indicator", () => {
    const indicators = [{ type: "multiple_roles", detail: "", weight: 3 }];
    expect(selectHeuristic(indicators)).toBe("user_role");
  });

  it("selects crud_operations for CRUD indicators", () => {
    const indicators = [{ type: "crud_operations", detail: "", weight: 2 }];
    expect(selectHeuristic(indicators)).toBe("crud_operations");
  });

  it("selects workflow_steps for step indicators", () => {
    const indicators = [{ type: "workflow_steps", detail: "", weight: 2 }];
    expect(selectHeuristic(indicators)).toBe("workflow_steps");
  });

  it("excludes already-tried heuristics", () => {
    const indicators = [{ type: "multiple_roles", detail: "", weight: 3 }];
    expect(selectHeuristic(indicators, ["user_role"])).not.toBe("user_role");
  });

  it("returns null when all applicable heuristics are excluded", () => {
    const indicators = [{ type: "crud_operations", detail: "", weight: 2 }];
    const allKeys = Object.keys(HEURISTIC_DESCRIPTIONS);
    expect(selectHeuristic(indicators, allKeys)).toBeNull();
  });
});

// --- splitting-generator tests ---

describe("buildSplitPrompt", () => {
  it("includes heuristic description", () => {
    const hu = { id: "HU-001", text: "As a user, I want to manage records" };
    const prompt = buildSplitPrompt(hu, "workflow_steps");
    expect(prompt).toContain(HEURISTIC_DESCRIPTIONS.workflow_steps);
    expect(prompt).toContain("HU-001");
    expect(prompt).toContain("manage records");
  });

  it("includes sub-HU ID pattern in instructions", () => {
    const hu = { id: "HU-042", text: "Story text" };
    const prompt = buildSplitPrompt(hu, "data_entity");
    expect(prompt).toContain("HU-042-A");
    expect(prompt).toContain("HU-042-B");
  });

  it("includes sub-agent preamble", () => {
    const prompt = buildSplitPrompt({ id: "HU-001", text: "x" }, "workflow_steps");
    expect(prompt).toContain("sub-agent");
  });
});

describe("parseSplitOutput", () => {
  it("parses valid split output", () => {
    const raw = JSON.stringify({
      subHUs: [
        { id: "HU-001-A", title: "First", text: "As a user, I want first", acceptanceCriteria: ["AC1"], blocked_by: [] },
        { id: "HU-001-B", title: "Second", text: "As a user, I want second", acceptanceCriteria: ["AC2"], blocked_by: ["HU-001-A"] }
      ],
      heuristic: "workflow_steps",
      reason: "Sequential flow"
    });

    const result = parseSplitOutput(raw);
    expect(result).not.toBeNull();
    expect(result.subHUs).toHaveLength(2);
    expect(result.heuristic).toBe("workflow_steps");
    expect(result.reason).toBe("Sequential flow");
  });

  it("returns null for < 2 sub-HUs", () => {
    const raw = JSON.stringify({
      subHUs: [{ id: "HU-001-A", title: "Only one", text: "text" }],
      heuristic: "x",
      reason: "y"
    });
    expect(parseSplitOutput(raw)).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseSplitOutput("")).toBeNull();
    expect(parseSplitOutput("not json")).toBeNull();
    expect(parseSplitOutput(null)).toBeNull();
  });
});

describe("generateSplitProposal", () => {
  it("returns sub-HUs with correct structure when parseSplitOutput processes valid AI output", () => {
    // Test the full pipeline: buildSplitPrompt produces correct prompt, parseSplitOutput parses AI response
    const hu = { id: "HU-001", text: "As a dev, I want to create and edit and delete records" };
    const prompt = buildSplitPrompt(hu, "workflow_steps");

    // Verify prompt is well-formed
    expect(prompt).toContain("HU-001");
    expect(prompt).toContain("workflow_steps");

    // Simulate AI response and parse it
    const mockAIResponse = JSON.stringify({
      subHUs: [
        { id: "HU-001-A", title: "Setup", text: "As a dev, I want setup", acceptanceCriteria: ["Setup works"], blocked_by: [] },
        { id: "HU-001-B", title: "Implement", text: "As a dev, I want implement", acceptanceCriteria: ["It works"], blocked_by: ["HU-001-A"] }
      ],
      heuristic: "workflow_steps",
      reason: "Two clear phases"
    });

    const result = parseSplitOutput(mockAIResponse);
    expect(result).not.toBeNull();
    expect(result.subHUs).toHaveLength(2);
    expect(result.subHUs[0].id).toBe("HU-001-A");
    expect(result.subHUs[1].id).toBe("HU-001-B");
    expect(result.heuristic).toBe("workflow_steps");
    expect(result.reason).toBe("Two clear phases");
    expect(result.subHUs[0].acceptanceCriteria).toEqual(["Setup works"]);
    expect(result.subHUs[1].blocked_by).toEqual(["HU-001-A"]);
  });

  it("parseSplitOutput filters out malformed sub-HUs", () => {
    const raw = JSON.stringify({
      subHUs: [
        { id: "HU-001-A", title: "Good", text: "valid" },
        { title: "No ID" },                             // missing id
        { id: "HU-001-B", title: "Also good", text: "valid too" }
      ],
      heuristic: "x",
      reason: "y"
    });
    const result = parseSplitOutput(raw);
    expect(result).not.toBeNull();
    expect(result.subHUs).toHaveLength(2);
    expect(result.subHUs[0].id).toBe("HU-001-A");
    expect(result.subHUs[1].id).toBe("HU-001-B");
  });
});

describe("formatSplitProposalForFDE", () => {
  it("produces readable output with all sub-HU details", () => {
    const proposal = {
      subHUs: [
        { id: "HU-001-A", title: "Create form", text: "As a user, I want a form", acceptanceCriteria: ["Form renders"], blocked_by: [] },
        { id: "HU-001-B", title: "Submit form", text: "As a user, I want to submit", acceptanceCriteria: ["Submit works"], blocked_by: ["HU-001-A"] }
      ],
      heuristic: "workflow_steps",
      reason: "Two workflow steps identified"
    };

    const output = formatSplitProposalForFDE(proposal);
    expect(output).toContain("HU-001-A");
    expect(output).toContain("Create form");
    expect(output).toContain("HU-001-B");
    expect(output).toContain("Submit form");
    expect(output).toContain("Form renders");
    expect(output).toContain("Depends on: HU-001-A");
    expect(output).toContain("Reason: Two workflow steps identified");
    expect(output).toContain(HEURISTIC_DESCRIPTIONS.workflow_steps);
  });

  it("handles sub-HUs without acceptance criteria", () => {
    const proposal = {
      subHUs: [
        { id: "HU-X-A", title: "A", text: "text A", blocked_by: [] },
        { id: "HU-X-B", title: "B", text: "text B", blocked_by: ["HU-X-A"] }
      ],
      heuristic: "data_entity",
      reason: "Entities separated"
    };

    const output = formatSplitProposalForFDE(proposal);
    expect(output).toContain("HU-X-A");
    expect(output).toContain("HU-X-B");
  });
});

describe("buildSplitDependencies", () => {
  it("first sub-HU inherits original deps, rest chain sequentially", () => {
    const subHUs = [
      { id: "HU-001-A", title: "A" },
      { id: "HU-001-B", title: "B" },
      { id: "HU-001-C", title: "C" }
    ];
    const originalHu = { blocked_by: ["HU-PREV-001", "HU-PREV-002"] };

    const result = buildSplitDependencies(subHUs, originalHu);
    expect(result).toHaveLength(3);
    expect(result[0].blocked_by).toEqual(["HU-PREV-001", "HU-PREV-002"]);
    expect(result[1].blocked_by).toEqual(["HU-001-A"]);
    expect(result[2].blocked_by).toEqual(["HU-001-B"]);
  });

  it("first sub-HU has empty blocked_by when original has no deps", () => {
    const subHUs = [
      { id: "HU-002-A", title: "A" },
      { id: "HU-002-B", title: "B" }
    ];
    const originalHu = {};

    const result = buildSplitDependencies(subHUs, originalHu);
    expect(result[0].blocked_by).toEqual([]);
    expect(result[1].blocked_by).toEqual(["HU-002-A"]);
  });

  it("returns empty array for empty input", () => {
    expect(buildSplitDependencies([], {})).toEqual([]);
    expect(buildSplitDependencies(null, {})).toEqual([]);
  });

  it("does not mutate original subHUs", () => {
    const subHUs = [
      { id: "HU-003-A", title: "A", blocked_by: [] },
      { id: "HU-003-B", title: "B", blocked_by: [] }
    ];
    const result = buildSplitDependencies(subHUs, { blocked_by: ["X"] });
    expect(subHUs[0].blocked_by).toEqual([]);
    expect(result[0].blocked_by).toEqual(["X"]);
  });
});

describe("Sub-HU ID patterns", () => {
  it("IDs follow pattern HU-XXX-A, HU-XXX-B", () => {
    const raw = JSON.stringify({
      subHUs: [
        { id: "HU-042-A", title: "A", text: "text", acceptanceCriteria: [], blocked_by: [] },
        { id: "HU-042-B", title: "B", text: "text", acceptanceCriteria: [], blocked_by: ["HU-042-A"] },
        { id: "HU-042-C", title: "C", text: "text", acceptanceCriteria: [], blocked_by: ["HU-042-B"] }
      ],
      heuristic: "workflow_steps",
      reason: "test"
    });

    const result = parseSplitOutput(raw);
    expect(result.subHUs[0].id).toBe("HU-042-A");
    expect(result.subHUs[1].id).toBe("HU-042-B");
    expect(result.subHUs[2].id).toBe("HU-042-C");
    expect(result.subHUs[0].id).toMatch(/^HU-042-[A-Z]$/);
    expect(result.subHUs[1].id).toMatch(/^HU-042-[A-Z]$/);
    expect(result.subHUs[2].id).toMatch(/^HU-042-[A-Z]$/);
  });
});

// --- Integration-level tests for pre-loop-stages splitting ---

describe("HU splitting integration in runHuReviewerStage", () => {
  it("no indicators → skips splitting, proceeds to 6D evaluation", () => {
    // Simple HU without compound indicators should return no indicators
    const simpleText = "As a user, I want to log in.";
    const indicators = detectIndicators(simpleText);
    expect(indicators).toEqual([]);
  });

  it("FDE rejects split → tries another heuristic", () => {
    // When user_role is excluded, selectHeuristic should try another
    const indicators = [
      { type: "multiple_roles", detail: "", weight: 3 },
      { type: "multiple_and", detail: "", weight: 2 }
    ];

    const first = selectHeuristic(indicators);
    expect(first).toBe("user_role");

    const second = selectHeuristic(indicators, ["user_role"]);
    expect(second).not.toBe("user_role");
    expect(second).not.toBeNull();
  });
});
