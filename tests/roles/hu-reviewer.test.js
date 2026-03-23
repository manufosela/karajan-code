import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { BaseRole, resolveRoleMdPath } from "../../src/roles/base-role.js";
import { buildHuReviewerPrompt, parseHuReviewerOutput } from "../../src/prompts/hu-reviewer.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("HU Reviewer role template", () => {
  const templatePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "templates",
    "roles",
    "hu-reviewer.md"
  );

  it("template file exists and is non-empty", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("contains all 6 dimensions", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/D1.*JTBD/i);
    expect(content).toMatch(/D2.*User Specificity/i);
    expect(content).toMatch(/D3.*Behavior Change/i);
    expect(content).toMatch(/D4.*Control Zone/i);
    expect(content).toMatch(/D5.*Time Constraints/i);
    expect(content).toMatch(/D6.*Survivable Experiment/i);
  });

  it("contains 7 antipatterns", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("ghost_user");
    expect(content).toContain("swiss_army_knife");
    expect(content).toContain("implementation_leak");
    expect(content).toContain("moving_goalpost");
    expect(content).toContain("orphan_story");
    expect(content).toContain("invisible_dependency");
    expect(content).toContain("premature_optimization");
  });

  it("contains HARD RULES", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/HARD RULE/);
    expect(content).toMatch(/Maximum score of 5/);
  });

  it("uses JSON output schema", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("\"evaluations\"");
    expect(content).toContain("\"batch_summary\"");
    expect(content).toContain("\"scores\"");
    expect(content).toContain("\"verdict\"");
    expect(content).toContain("\"antipatterns_detected\"");
  });

  it("loads correctly via role resolver", async () => {
    const role = new BaseRole({ name: "hu-reviewer", config: {}, logger });
    await role.init();
    expect(role.instructions).toBeTruthy();
    expect(role.instructions).toContain("HU Reviewer");
  });

  it("resolveRoleMdPath includes hu-reviewer.md candidate", () => {
    const candidates = resolveRoleMdPath("hu-reviewer", "/my/project");
    expect(candidates.some(c => c.endsWith("hu-reviewer.md"))).toBe(true);
  });
});

describe("parseHuReviewerOutput", () => {
  it("parses valid JSON with evaluations", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-001",
        scores: {
          D1_jtbd_context: 7,
          D2_user_specificity: 8,
          D3_behavior_change: 6,
          D4_control_zone: 5,
          D5_time_constraints: 4,
          D6_survivable_experiment: 3
        },
        total: 33,
        antipatterns_detected: ["ghost_user"],
        verdict: "needs_rewrite",
        evaluation_notes: "Missing persona",
        rewritten: { as: "Dr. Smith" },
        certified_hu: null,
        context_needed: null
      }],
      batch_summary: {
        total: 1,
        certified: 0,
        needs_rewrite: 1,
        needs_context: 0,
        consolidated_questions: ""
      }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result).not.toBeNull();
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].story_id).toBe("HU-001");
    expect(result.evaluations[0].scores.D1_jtbd_context).toBe(7);
    expect(result.evaluations[0].antipatterns_detected).toEqual(["ghost_user"]);
    expect(result.evaluations[0].verdict).toBe("needs_rewrite");
    expect(result.batch_summary.needs_rewrite).toBe(1);
  });

  it("returns null on invalid input", () => {
    expect(parseHuReviewerOutput("")).toBeNull();
    expect(parseHuReviewerOutput("not json at all")).toBeNull();
    expect(parseHuReviewerOutput("{}")).toBeNull();
    expect(parseHuReviewerOutput(null)).toBeNull();
  });

  it("returns null when evaluations is empty", () => {
    const raw = JSON.stringify({ evaluations: [], batch_summary: {} });
    expect(parseHuReviewerOutput(raw)).toBeNull();
  });

  it("clamps scores to 0-10 range", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-002",
        scores: {
          D1_jtbd_context: 15,
          D2_user_specificity: -3,
          D3_behavior_change: 5,
          D4_control_zone: 5,
          D5_time_constraints: 5,
          D6_survivable_experiment: 5
        },
        total: 32,
        antipatterns_detected: [],
        verdict: "certified",
        evaluation_notes: ""
      }],
      batch_summary: { total: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result.evaluations[0].scores.D1_jtbd_context).toBe(10);
    expect(result.evaluations[0].scores.D2_user_specificity).toBe(0);
  });

  it("filters invalid antipatterns", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-003",
        scores: { D1_jtbd_context: 5, D2_user_specificity: 5, D3_behavior_change: 5, D4_control_zone: 5, D5_time_constraints: 5, D6_survivable_experiment: 5 },
        total: 30,
        antipatterns_detected: ["ghost_user", "not_a_real_antipattern"],
        verdict: "certified",
        evaluation_notes: ""
      }],
      batch_summary: { total: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result.evaluations[0].antipatterns_detected).toEqual(["ghost_user"]);
  });

  it("defaults unknown verdict to needs_context", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-004",
        scores: { D1_jtbd_context: 5, D2_user_specificity: 5, D3_behavior_change: 5, D4_control_zone: 5, D5_time_constraints: 5, D6_survivable_experiment: 5 },
        total: 30,
        antipatterns_detected: [],
        verdict: "UNKNOWN_VERDICT",
        evaluation_notes: ""
      }],
      batch_summary: { total: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result.evaluations[0].verdict).toBe("needs_context");
  });

  it("extracts JSON from surrounding text", () => {
    const raw = `Here is my analysis:\n${JSON.stringify({
      evaluations: [{
        story_id: "HU-005",
        scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
        total: 42,
        antipatterns_detected: [],
        verdict: "certified",
        evaluation_notes: "Good",
        certified_hu: { as: "a doctor" }
      }],
      batch_summary: { total: 1, certified: 1 }
    })}\nDone.`;

    const result = parseHuReviewerOutput(raw);
    expect(result).not.toBeNull();
    expect(result.evaluations[0].verdict).toBe("certified");
  });
});

describe("buildHuReviewerPrompt", () => {
  it("includes stories and instructions", () => {
    const prompt = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a user, I want X" }],
      instructions: "# Custom instructions",
      context: "Extra context"
    });
    expect(prompt).toContain("HU-001");
    expect(prompt).toContain("As a user, I want X");
    expect(prompt).toContain("Custom instructions");
    expect(prompt).toContain("Extra context");
    expect(prompt).toContain("sub-agent");
  });

  it("works without context", () => {
    const prompt = buildHuReviewerPrompt({
      stories: [{ id: "HU-002", text: "Story text" }],
      instructions: null
    });
    expect(prompt).toContain("HU-002");
    expect(prompt).not.toContain("Additional Context");
  });
});

describe("D2 and D3 HARD RULE enforcement in parseHuReviewerOutput", () => {
  it("D2 HARD RULE: max 5 without specific user is preserved in output", () => {
    // The parser preserves scores as given (clamped to 0-10).
    // The HARD RULE enforcement happens in the AI prompt, not the parser.
    // The parser just ensures scores are valid numbers in range.
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-D2",
        scores: { D1_jtbd_context: 7, D2_user_specificity: 5, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
        total: 40,
        antipatterns_detected: [],
        verdict: "needs_rewrite",
        evaluation_notes: "D2 capped at 5 due to generic user"
      }],
      batch_summary: { total: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result.evaluations[0].scores.D2_user_specificity).toBe(5);
    expect(result.evaluations[0].verdict).toBe("needs_rewrite");
  });

  it("D3 HARD RULE: max 5 without quantification is preserved in output", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-D3",
        scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 5, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
        total: 40,
        antipatterns_detected: [],
        verdict: "needs_rewrite",
        evaluation_notes: "D3 capped at 5 due to no quantification"
      }],
      batch_summary: { total: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result.evaluations[0].scores.D3_behavior_change).toBe(5);
    expect(result.evaluations[0].verdict).toBe("needs_rewrite");
  });
});
