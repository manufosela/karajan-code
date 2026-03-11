import { describe, it, expect } from "vitest";
import { buildDiscoverPrompt, parseDiscoverOutput, DISCOVER_MODES } from "../src/prompts/discover.js";

describe("buildDiscoverPrompt", () => {
  it("returns a string containing the task", () => {
    const prompt = buildDiscoverPrompt({ task: "Add login page" });
    expect(prompt).toContain("Add login page");
  });

  it("includes sub-agent preamble", () => {
    const prompt = buildDiscoverPrompt({ task: "x" });
    expect(prompt).toContain("Karajan sub-agent");
    expect(prompt).toContain("Do NOT use any MCP tools");
  });

  it("includes instructions when provided", () => {
    const prompt = buildDiscoverPrompt({ task: "x", instructions: "Custom discover instructions" });
    expect(prompt).toContain("Custom discover instructions");
  });

  it("omits instructions section when null", () => {
    const prompt = buildDiscoverPrompt({ task: "x", instructions: null });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes JSON schema for gaps mode (default)", () => {
    const prompt = buildDiscoverPrompt({ task: "x" });
    expect(prompt).toContain("verdict");
    expect(prompt).toContain("gaps");
    expect(prompt).toContain("severity");
  });

  it("includes context when provided", () => {
    const prompt = buildDiscoverPrompt({ task: "x", context: "Some research context" });
    expect(prompt).toContain("Some research context");
  });

  it("defaults to gaps mode", () => {
    const prompt = buildDiscoverPrompt({ task: "x" });
    expect(prompt).toContain("gaps");
  });

  it("accepts explicit mode parameter", () => {
    const prompt = buildDiscoverPrompt({ task: "x", mode: "gaps" });
    expect(prompt).toContain("gaps");
  });
});

describe("buildDiscoverPrompt — momtest mode", () => {
  it("includes Mom Test rules when mode is momtest", () => {
    const prompt = buildDiscoverPrompt({ task: "x", mode: "momtest" });
    expect(prompt).toContain("Mom Test");
    expect(prompt).toContain("past behavior");
  });

  it("includes momTestQuestions in JSON schema for momtest mode", () => {
    const prompt = buildDiscoverPrompt({ task: "x", mode: "momtest" });
    expect(prompt).toContain("momTestQuestions");
    expect(prompt).toContain("targetRole");
  });

  it("does not include Mom Test rules in gaps mode", () => {
    const prompt = buildDiscoverPrompt({ task: "x", mode: "gaps" });
    expect(prompt).not.toContain("Mom Test");
  });
});

describe("DISCOVER_MODES", () => {
  it("exports gaps as a valid mode", () => {
    expect(DISCOVER_MODES).toContain("gaps");
  });

  it("exports momtest as a valid mode", () => {
    expect(DISCOVER_MODES).toContain("momtest");
  });
});

describe("parseDiscoverOutput", () => {
  it("parses valid JSON with gaps", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [
        { id: "gap-1", description: "Missing auth details", severity: "critical", suggestedQuestion: "How should auth work?" }
      ],
      summary: "1 gap found"
    });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed.verdict).toBe("needs_validation");
    expect(parsed.gaps).toHaveLength(1);
    expect(parsed.gaps[0].id).toBe("gap-1");
    expect(parsed.gaps[0].severity).toBe("critical");
  });

  it("parses JSON embedded in markdown", () => {
    const raw = `Here is my analysis:\n\`\`\`json\n${JSON.stringify({
      verdict: "ready",
      gaps: [],
      summary: "Well defined"
    })}\n\`\`\`\nDone.`;
    const parsed = parseDiscoverOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed.verdict).toBe("ready");
    expect(parsed.gaps).toEqual([]);
  });

  it("returns null for non-JSON output", () => {
    expect(parseDiscoverOutput("no json here")).toBeNull();
  });

  it("returns null for empty/null input", () => {
    expect(parseDiscoverOutput("")).toBeNull();
    expect(parseDiscoverOutput(null)).toBeNull();
    expect(parseDiscoverOutput(undefined)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseDiscoverOutput("{invalid json}")).toBeNull();
  });

  it("normalizes verdict to valid values", () => {
    const raw = JSON.stringify({ verdict: "ready", gaps: [] });
    const parsed = parseDiscoverOutput(raw);
    expect(["ready", "needs_validation"]).toContain(parsed.verdict);
  });

  it("normalizes severity to valid values", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [{ id: "g1", description: "x", severity: "CRITICAL", suggestedQuestion: "q" }]
    });
    const parsed = parseDiscoverOutput(raw);
    expect(["critical", "major", "minor"]).toContain(parsed.gaps[0].severity);
  });

  it("defaults severity to major for unknown values", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [{ id: "g1", description: "x", severity: "unknown_severity", suggestedQuestion: "q" }]
    });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed.gaps[0].severity).toBe("major");
  });

  it("filters out gaps missing required fields", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [
        { id: "g1", description: "valid", severity: "major", suggestedQuestion: "q" },
        { id: "g2" },
        { description: "no id" }
      ]
    });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed.gaps).toHaveLength(1);
    expect(parsed.gaps[0].id).toBe("g1");
  });

  it("parses momTestQuestions from output", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [{ id: "g1", description: "Missing auth", severity: "critical", suggestedQuestion: "q" }],
      momTestQuestions: [
        { gapId: "g1", question: "When was the last time you logged in manually?", targetRole: "end-user", rationale: "Validates if auth is actually needed" }
      ]
    });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed.momTestQuestions).toHaveLength(1);
    expect(parsed.momTestQuestions[0].gapId).toBe("g1");
    expect(parsed.momTestQuestions[0].targetRole).toBe("end-user");
  });

  it("returns empty momTestQuestions when not present", () => {
    const raw = JSON.stringify({ verdict: "ready", gaps: [] });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed.momTestQuestions).toEqual([]);
  });

  it("filters momTestQuestions missing required fields", () => {
    const raw = JSON.stringify({
      verdict: "needs_validation",
      gaps: [{ id: "g1", description: "x", severity: "major", suggestedQuestion: "q" }],
      momTestQuestions: [
        { gapId: "g1", question: "Valid question?", targetRole: "dev", rationale: "reason" },
        { gapId: "g1" },
        { question: "No gapId" }
      ]
    });
    const parsed = parseDiscoverOutput(raw);
    expect(parsed.momTestQuestions).toHaveLength(1);
  });
});
