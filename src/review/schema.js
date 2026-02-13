export function validateReviewResult(reviewResult) {
  if (!reviewResult || typeof reviewResult !== "object") {
    throw new Error("Reviewer output must be a JSON object");
  }

  if (typeof reviewResult.approved !== "boolean") {
    throw new Error("Reviewer output missing boolean field: approved");
  }

  if (!Array.isArray(reviewResult.blocking_issues)) {
    throw new Error("Reviewer output missing array field: blocking_issues");
  }

  if (!Array.isArray(reviewResult.non_blocking_suggestions)) {
    reviewResult.non_blocking_suggestions = [];
  }

  if (typeof reviewResult.summary !== "string") {
    reviewResult.summary = "";
  }

  if (typeof reviewResult.confidence !== "number") {
    reviewResult.confidence = 0.5;
  }

  if (reviewResult.approved && reviewResult.blocking_issues.length > 0) {
    throw new Error("Invalid reviewer output: approved=true with blocking issues");
  }

  return reviewResult;
}
