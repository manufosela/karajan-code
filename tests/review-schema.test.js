import { describe, expect, it } from "vitest";
import { validateReviewResult } from "../src/review/schema.js";

describe("validateReviewResult", () => {
  it("accepts valid shape", () => {
    const output = validateReviewResult({
      approved: false,
      blocking_issues: [{ id: "A", description: "Issue" }],
      non_blocking_suggestions: [],
      summary: "x",
      confidence: 0.8
    });

    expect(output.approved).toBe(false);
    expect(output.blocking_issues).toHaveLength(1);
  });

  it("rejects approved with blockers", () => {
    expect(() =>
      validateReviewResult({
        approved: true,
        blocking_issues: [{ id: "A" }],
        non_blocking_suggestions: []
      })
    ).toThrow();
  });
});
