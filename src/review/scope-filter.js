/**
 * Scope filter — auto-defers reviewer blocking issues that reference
 * files NOT present in the diff.  This prevents reviewer scope drift
 * (flagging missing features, unchanged code, future tasks) from
 * stalling the pipeline.
 *
 * Deferred issues are NOT forgotten — they are tracked in the session
 * as technical debt that should be resolved in future iterations or
 * follow-up tasks.  The coder and planner receive context about what
 * was deferred and why.
 */

/**
 * Extract the set of changed file paths from a unified diff string.
 */
export function extractDiffFiles(diff) {
  const files = new Set();
  for (const line of (diff || "").split("\n")) {
    // Match "+++ b/path" lines in unified diff
    const m = line.match(/^\+\+\+ b\/(.+)/);
    if (m) files.add(m[1]);
  }
  return files;
}

/**
 * Determine whether a blocking issue is within scope of the diff.
 *
 * An issue is considered IN scope when:
 * - It has no `file` field (general concern about the diff)
 * - Its `file` matches one of the changed files (exact or suffix match)
 * - It references a pattern present in the diff content itself
 *
 * An issue is OUT of scope when:
 * - It explicitly references a file NOT in the diff
 */
export function isIssueInScope(issue, diffFiles, diffContent) {
  const file = (issue.file || "").trim();

  // No file specified — the reviewer is commenting on the diff generally
  if (!file) return true;

  // Direct match
  if (diffFiles.has(file)) return true;

  // Suffix match (reviewer might use full path vs relative)
  for (const df of diffFiles) {
    if (df.endsWith(file) || file.endsWith(df)) return true;
  }

  // Check if the file path appears anywhere in the diff content
  // (covers cases where the file is referenced in imports/requires)
  if (diffContent && diffContent.includes(file)) return true;

  return false;
}

/**
 * Filter a review result, demoting out-of-scope blocking issues to
 * non-blocking suggestions.
 *
 * Returns { review, demoted, allDemoted } where:
 * - review: the filtered review (may flip approved to true)
 * - demoted: array of issues that were demoted
 * - allDemoted: true if ALL blocking issues were out of scope
 */
export function filterReviewScope(review, diff) {
  if (!review || review.approved) {
    return { review, demoted: [], allDemoted: false };
  }

  const diffFiles = extractDiffFiles(diff);

  // If we can't parse diff files, don't filter (safety)
  if (diffFiles.size === 0) {
    return { review, demoted: [], allDemoted: false };
  }

  const inScope = [];
  const demoted = [];

  for (const issue of review.blocking_issues || []) {
    if (isIssueInScope(issue, diffFiles, diff)) {
      inScope.push(issue);
    } else {
      demoted.push(issue);
    }
  }

  if (demoted.length === 0) {
    return { review, demoted: [], allDemoted: false };
  }

  const demotedSuggestions = demoted.map(
    (issue) => `[auto-demoted] ${issue.file || "unknown"}: ${issue.description || issue.id || "no description"}`
  );

  const filtered = {
    ...review,
    blocking_issues: inScope,
    non_blocking_suggestions: [
      ...(review.non_blocking_suggestions || []),
      ...demotedSuggestions
    ]
  };

  // If no in-scope blocking issues remain, auto-approve
  const allDemoted = inScope.length === 0;
  if (allDemoted) {
    filtered.approved = true;
    filtered.summary = `${review.summary || ""} [Auto-approved: ${demoted.length} out-of-scope issue(s) demoted to suggestions]`.trim();
  }

  // Build structured deferred issues for session tracking
  const deferred = demoted.map((issue) => ({
    id: issue.id || null,
    file: issue.file || null,
    severity: issue.severity || "medium",
    description: issue.description || "no description",
    suggested_fix: issue.suggested_fix || null,
    deferred_at: new Date().toISOString(),
    reason: "out_of_scope"
  }));

  return { review: filtered, demoted, deferred, allDemoted };
}

/**
 * Build a human-readable summary of deferred issues for injection
 * into coder/planner prompts so they are aware of the tech debt.
 */
export function buildDeferredContext(deferredIssues) {
  if (!deferredIssues?.length) return "";

  const lines = [
    "## Deferred reviewer concerns (technical debt)",
    "The following issues were flagged by the reviewer but deferred because they are outside the current diff scope.",
    "You do NOT need to fix them now, but be aware of them:",
    ""
  ];

  for (const issue of deferredIssues) {
    const file = issue.file ? `\`${issue.file}\`` : "general";
    const fix = issue.suggested_fix ? ` — Suggestion: ${issue.suggested_fix}` : "";
    lines.push(`- [${issue.severity}] ${file}: ${issue.description}${fix}`);
  }

  lines.push("");
  lines.push("If your current changes naturally address any of these, great. Otherwise, they will be tracked for future resolution.");

  return lines.join("\n");
}
