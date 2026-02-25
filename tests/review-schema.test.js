import { describe, expect, it } from "vitest";
import { validateReviewResult } from "../src/review/schema.js";

describe("validateReviewResult", () => {
  it("accepts valid complete shape", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "A", description: "Issue" }],
      non_blocking_suggestions: ["Consider refactoring"],
      summary: "Needs work",
      confidence: 0.8
    });

    expect(output.approved).toBe(false);
    expect(output.blocking_issues).toHaveLength(1);
    expect(output.non_blocking_suggestions).toEqual(["Consider refactoring"]);
    expect(output.summary).toBe("Needs work");
    expect(output.confidence).toBe(0.8);
  });

  it("accepts approved=true with empty blocking_issues", () => {
    const output = validateReviewResult({
      approved: true,
      blocking_issues: [],
      summary: "All good"
    });

    expect(output.approved).toBe(true);
  });

  it("throws for null input", () => {
    expect(() => validateReviewResult(null)).toThrow("must be a JSON object");
  });

  it("throws for undefined input", () => {
    expect(() => validateReviewResult(undefined)).toThrow("must be a JSON object");
  });

  it("throws for non-object input", () => {
    expect(() => validateReviewResult("string")).toThrow("must be a JSON object");
    expect(() => validateReviewResult(42)).toThrow("must be a JSON object");
  });

  it("throws when approved is missing", () => {
    expect(() =>
      validateReviewResult({ blocking_issues: [] })
    ).toThrow("missing boolean field: approved");
  });

  it("throws when approved is not boolean", () => {
    expect(() =>
      validateReviewResult({ approved: "yes", blocking_issues: [] })
    ).toThrow("missing boolean field: approved");
  });

  it("throws when blocking_issues is missing", () => {
    expect(() =>
      validateReviewResult({ approved: false })
    ).toThrow("missing array field: blocking_issues");
  });

  it("throws when blocking_issues is not an array", () => {
    expect(() =>
      validateReviewResult({ approved: false, blocking_issues: "none" })
    ).toThrow("missing array field: blocking_issues");
  });

  it("defaults non_blocking_suggestions to empty array", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "A" }]
    });

    expect(output.non_blocking_suggestions).toEqual([]);
  });

  it("defaults summary to empty string", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "A" }]
    });

    expect(output.summary).toBe("");
  });

  it("defaults confidence to 0.5", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "A" }]
    });

    expect(output.confidence).toBe(0.5);
  });

  it("rejects approved=true with blocking issues", () => {
    expect(() =>
      validateReviewResult({
        approved: true,
        blocking_issues: [{ id: "A" }],
        non_blocking_suggestions: []
      })
    ).toThrow("approved=true with blocking issues");
  });

  it("preserves existing optional fields when present", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "B" }],
      non_blocking_suggestions: ["Suggestion"],
      summary: "Review summary",
      confidence: 0.95
    });

    expect(output.non_blocking_suggestions).toEqual(["Suggestion"]);
    expect(output.summary).toBe("Review summary");
    expect(output.confidence).toBe(0.95);
  });
});
