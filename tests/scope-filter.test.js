import { describe, it, expect } from "vitest";
import { extractDiffFiles, isIssueInScope, filterReviewScope, buildDeferredContext } from "../src/review/scope-filter.js";

const SAMPLE_DIFF = `diff --git a/src/foo.js b/src/foo.js
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 export { a };
diff --git a/src/bar.js b/src/bar.js
--- a/src/bar.js
+++ b/src/bar.js
@@ -1,2 +1,3 @@
 export function bar() {}
+export function baz() {}
`;

describe("extractDiffFiles", () => {
  it("extracts file paths from unified diff", () => {
    const files = extractDiffFiles(SAMPLE_DIFF);
    expect(files).toEqual(new Set(["src/foo.js", "src/bar.js"]));
  });

  it("returns empty set for empty diff", () => {
    expect(extractDiffFiles("")).toEqual(new Set());
    expect(extractDiffFiles(null)).toEqual(new Set());
  });
});

describe("isIssueInScope", () => {
  const diffFiles = new Set(["src/foo.js", "src/bar.js"]);

  it("returns true when issue has no file", () => {
    expect(isIssueInScope({ description: "general issue" }, diffFiles, SAMPLE_DIFF)).toBe(true);
  });

  it("returns true when issue file is in diff", () => {
    expect(isIssueInScope({ file: "src/foo.js" }, diffFiles, SAMPLE_DIFF)).toBe(true);
  });

  it("returns false when issue file is NOT in diff", () => {
    expect(isIssueInScope({ file: "src/missing.js" }, diffFiles, "")).toBe(false);
  });

  it("handles suffix matching", () => {
    expect(isIssueInScope({ file: "foo.js" }, diffFiles, "")).toBe(true);
  });

  it("returns true when file appears in diff content", () => {
    const diff = SAMPLE_DIFF + '\nimport { helper } from "./utils/helper.js";';
    expect(isIssueInScope({ file: "utils/helper.js" }, diffFiles, diff)).toBe(true);
  });
});

describe("filterReviewScope", () => {
  it("returns unchanged review when already approved", () => {
    const review = { approved: true, blocking_issues: [], non_blocking_suggestions: [] };
    const result = filterReviewScope(review, SAMPLE_DIFF);
    expect(result.demoted).toEqual([]);
    expect(result.review.approved).toBe(true);
  });

  it("demotes out-of-scope blocking issues", () => {
    const review = {
      approved: false,
      blocking_issues: [
        { id: "1", file: "src/foo.js", description: "in scope issue" },
        { id: "2", file: "src/unrelated.js", description: "out of scope issue" }
      ],
      non_blocking_suggestions: [],
      summary: "Review"
    };
    const result = filterReviewScope(review, SAMPLE_DIFF);
    expect(result.demoted).toHaveLength(1);
    expect(result.demoted[0].id).toBe("2");
    expect(result.review.blocking_issues).toHaveLength(1);
    expect(result.review.blocking_issues[0].id).toBe("1");
    expect(result.review.approved).toBe(false);
    expect(result.allDemoted).toBe(false);
  });

  it("auto-approves when ALL blocking issues are out of scope", () => {
    const review = {
      approved: false,
      blocking_issues: [
        { id: "1", file: "firestore.rules", description: "missing rules" },
        { id: "2", file: "pages/admin.js", description: "missing page" }
      ],
      non_blocking_suggestions: ["existing suggestion"],
      summary: "Rejected"
    };
    const result = filterReviewScope(review, SAMPLE_DIFF);
    expect(result.demoted).toHaveLength(2);
    expect(result.deferred).toHaveLength(2);
    expect(result.allDemoted).toBe(true);
    expect(result.review.approved).toBe(true);
    expect(result.review.blocking_issues).toHaveLength(0);
    expect(result.review.non_blocking_suggestions).toHaveLength(3);
  });

  it("produces structured deferred issues with metadata", () => {
    const review = {
      approved: false,
      blocking_issues: [
        { id: "1", file: "firestore.rules", severity: "high", description: "missing rules", suggested_fix: "add rules" }
      ],
      non_blocking_suggestions: []
    };
    const result = filterReviewScope(review, SAMPLE_DIFF);
    expect(result.deferred).toHaveLength(1);
    const d = result.deferred[0];
    expect(d.file).toBe("firestore.rules");
    expect(d.severity).toBe("high");
    expect(d.description).toBe("missing rules");
    expect(d.suggested_fix).toBe("add rules");
    expect(d.reason).toBe("out_of_scope");
    expect(d.deferred_at).toBeTruthy();
  });

  it("does not filter when diff is empty", () => {
    const review = {
      approved: false,
      blocking_issues: [{ id: "1", file: "src/x.js", description: "issue" }],
      non_blocking_suggestions: []
    };
    const result = filterReviewScope(review, "");
    expect(result.demoted).toEqual([]);
    expect(result.review.approved).toBe(false);
  });

  it("keeps issues without file field as in-scope", () => {
    const review = {
      approved: false,
      blocking_issues: [
        { id: "1", description: "general architecture concern" },
        { id: "2", file: "src/nonexistent.js", description: "out of scope" }
      ],
      non_blocking_suggestions: []
    };
    const result = filterReviewScope(review, SAMPLE_DIFF);
    expect(result.review.blocking_issues).toHaveLength(1);
    expect(result.review.blocking_issues[0].id).toBe("1");
    expect(result.demoted).toHaveLength(1);
  });
});

describe("buildDeferredContext", () => {
  it("returns empty string for no deferred issues", () => {
    expect(buildDeferredContext([])).toBe("");
    expect(buildDeferredContext(null)).toBe("");
  });

  it("builds readable context with deferred issues", () => {
    const deferred = [
      { file: "firestore.rules", severity: "high", description: "missing security rules", suggested_fix: "add rules file" },
      { file: null, severity: "medium", description: "no error handling" }
    ];
    const context = buildDeferredContext(deferred);
    expect(context).toContain("Deferred reviewer concerns");
    expect(context).toContain("technical debt");
    expect(context).toContain("`firestore.rules`");
    expect(context).toContain("missing security rules");
    expect(context).toContain("Suggestion: add rules file");
    expect(context).toContain("no error handling");
    expect(context).toContain("tracked for future resolution");
  });

  it("shows general for issues without file", () => {
    const deferred = [{ severity: "low", description: "minor concern" }];
    const context = buildDeferredContext(deferred);
    expect(context).toContain("general: minor concern");
  });
});
