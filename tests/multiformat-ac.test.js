import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  detectAcFormat,
  normalizeAcceptanceCriteria,
  parseHuReviewerOutput
} from "../src/prompts/hu-reviewer.js";

describe("detectAcFormat", () => {
  it("detects legacy Gherkin object format", () => {
    const result = detectAcFormat({ given: "a valid user", when: "they log in", then: "they see the dashboard" });
    expect(result.format).toBe("gherkin");
    expect(result.text).toContain("a valid user");
    expect(result.text).toContain("they log in");
    expect(result.text).toContain("they see the dashboard");
  });

  it("detects [GHERKIN] prefixed string", () => {
    const result = detectAcFormat("[GHERKIN] Given a user, When they click login, Then they are authenticated");
    expect(result.format).toBe("gherkin");
    expect(result.text).toBe("Given a user, When they click login, Then they are authenticated");
  });

  it("detects [CHECKLIST] prefixed string", () => {
    const result = detectAcFormat("[CHECKLIST] Module exports validateDNI function");
    expect(result.format).toBe("checklist");
    expect(result.text).toBe("Module exports validateDNI function");
  });

  it("detects [PRE_POST] prefixed string", () => {
    const result = detectAcFormat("[PRE_POST] Before: no cache; After: Redis cache with TTL 300s");
    expect(result.format).toBe("pre_post");
    expect(result.text).toBe("Before: no cache; After: Redis cache with TTL 300s");
  });

  it("detects [INVARIANT] prefixed string", () => {
    const result = detectAcFormat("[INVARIANT] All existing tests still pass after changes");
    expect(result.format).toBe("invariant");
    expect(result.text).toBe("All existing tests still pass after changes");
  });

  it("defaults unprefixed strings to checklist", () => {
    const result = detectAcFormat("Function should return true for valid input");
    expect(result.format).toBe("checklist");
    expect(result.text).toBe("Function should return true for valid input");
  });

  it("handles case-insensitive prefixes", () => {
    const result = detectAcFormat("[gherkin] Given something, When action, Then result");
    expect(result.format).toBe("gherkin");
  });

  it("handles null/undefined gracefully", () => {
    const result = detectAcFormat(null);
    expect(result.format).toBe("checklist");
  });

  it("handles partial Gherkin object (only given)", () => {
    const result = detectAcFormat({ given: "a condition" });
    expect(result.format).toBe("gherkin");
    expect(result.text).toContain("a condition");
  });
});

describe("normalizeAcceptanceCriteria", () => {
  it("normalizes mixed array of old and new formats", () => {
    const criteria = [
      { given: "a user", when: "login", then: "dashboard" },
      "[CHECKLIST] Tests pass",
      "[INVARIANT] No regressions",
      "Plain text criterion"
    ];

    const result = normalizeAcceptanceCriteria(criteria);
    expect(result).toHaveLength(4);
    expect(result[0].format).toBe("gherkin");
    expect(result[1].format).toBe("checklist");
    expect(result[2].format).toBe("invariant");
    expect(result[3].format).toBe("checklist");
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeAcceptanceCriteria(null)).toEqual([]);
    expect(normalizeAcceptanceCriteria(undefined)).toEqual([]);
    expect(normalizeAcceptanceCriteria("not array")).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(normalizeAcceptanceCriteria([])).toEqual([]);
  });
});

describe("parseHuReviewerOutput with multi-format AC", () => {
  it("parses certified_hu with legacy Gherkin acceptance_criteria", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-010",
        scores: { D1_jtbd_context: 8, D2_user_specificity: 8, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 6, D6_survivable_experiment: 5 },
        total: 41,
        antipatterns_detected: [],
        verdict: "certified",
        evaluation_notes: "Good user story",
        certified_hu: {
          as: "Dr. Garcia, an orthodontist",
          context: "Creating treatment plans",
          want: "See patient history",
          so_that: "Reduce errors by 30%",
          acceptance_criteria: [
            { given: "a patient with history", when: "doctor opens plan", then: "history is visible" }
          ]
        }
      }],
      batch_summary: { total: 1, certified: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result).not.toBeNull();
    expect(result.evaluations[0].certified_hu.acceptance_criteria).toHaveLength(1);
    expect(result.evaluations[0].certified_hu.acceptance_criteria[0]).toHaveProperty("given");
  });

  it("parses certified_hu with prefixed string acceptance_criteria", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-011",
        scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
        total: 42,
        antipatterns_detected: [],
        verdict: "certified",
        evaluation_notes: "Technical task",
        certified_hu: {
          as: "Backend developer maintaining the API",
          context: "Refactoring authentication module",
          want: "Extract auth logic into separate service",
          so_that: "Reduce coupling and improve testability (coverage from 60% to 90%)",
          acceptance_criteria: [
            "[CHECKLIST] AuthService exported from src/services/auth.js",
            "[INVARIANT] All existing tests still pass",
            "[INVARIANT] API responses unchanged for all endpoints"
          ]
        }
      }],
      batch_summary: { total: 1, certified: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result).not.toBeNull();
    expect(result.evaluations[0].certified_hu.acceptance_criteria).toHaveLength(3);
    expect(result.evaluations[0].certified_hu.acceptance_criteria[0]).toContain("[CHECKLIST]");
    expect(result.evaluations[0].certified_hu.acceptance_criteria[1]).toContain("[INVARIANT]");
  });

  it("parses certified_hu with mixed format acceptance_criteria", () => {
    const raw = JSON.stringify({
      evaluations: [{
        story_id: "HU-012",
        scores: { D1_jtbd_context: 7, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 7, D5_time_constraints: 7, D6_survivable_experiment: 7 },
        total: 42,
        antipatterns_detected: [],
        verdict: "certified",
        evaluation_notes: "Mixed formats",
        certified_hu: {
          as: "DevOps engineer",
          context: "Deploying new Redis cache",
          want: "Add caching layer",
          so_that: "Reduce API latency by 50%",
          acceptance_criteria: [
            "[PRE_POST] Before: no cache layer; After: Redis cache with TTL 300s",
            "[GHERKIN] Given a cached endpoint, When called twice, Then second call returns in < 10ms",
            "[CHECKLIST] Redis health check endpoint responds with 200"
          ]
        }
      }],
      batch_summary: { total: 1, certified: 1 }
    });

    const result = parseHuReviewerOutput(raw);
    expect(result).not.toBeNull();
    const ac = result.evaluations[0].certified_hu.acceptance_criteria;
    expect(ac).toHaveLength(3);
    expect(ac[0]).toContain("[PRE_POST]");
    expect(ac[1]).toContain("[GHERKIN]");
    expect(ac[2]).toContain("[CHECKLIST]");
  });
});

describe("hu-reviewer.md template multi-format AC", () => {
  const templatePath = path.resolve(
    import.meta.dirname,
    "..",
    "templates",
    "roles",
    "hu-reviewer.md"
  );

  it("contains multi-format AC guidance", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("Acceptance Criteria Format");
    expect(content).toContain("Gherkin");
    expect(content).toContain("Verifiable Checklist");
    expect(content).toContain("Pre/Post Conditions");
    expect(content).toContain("Invariants");
  });

  it("contains selection rule", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("Selection rule");
    expect(content).toContain("Classify the task FIRST");
  });

  it("contains prefixing convention", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("[GHERKIN]");
    expect(content).toContain("[CHECKLIST]");
    expect(content).toContain("[PRE_POST]");
    expect(content).toContain("[INVARIANT]");
  });

  it("supports both legacy and new AC formats in certified HU", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("legacy Gherkin objects");
    expect(content).toContain("prefixed strings");
  });
});
