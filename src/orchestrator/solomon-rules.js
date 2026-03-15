/**
 * Solomon rules engine — detects anomalies during session execution.
 * Each rule returns { triggered: boolean, severity: "warn"|"critical", message, detail }
 */

const DEFAULT_RULES = {
  max_files_per_iteration: 10,
  max_stale_iterations: 3,
  no_new_dependencies_without_task: true,
  scope_guard: true,
  reviewer_overreach: true,
  reviewer_style_block: true
};

export function evaluateRules(context, rulesConfig = {}) {
  const rules = { ...DEFAULT_RULES, ...rulesConfig };
  const alerts = [];

  // Rule 1: Too many files modified
  if (rules.max_files_per_iteration && context.filesChanged > rules.max_files_per_iteration) {
    alerts.push({
      rule: "max_files_per_iteration",
      severity: "critical",
      message: `Coder modified ${context.filesChanged} files (limit: ${rules.max_files_per_iteration}). Possible scope drift.`,
      detail: { filesChanged: context.filesChanged, limit: rules.max_files_per_iteration }
    });
  }

  // Rule 2: Stale iterations (no progress)
  if (rules.max_stale_iterations && context.staleIterations >= rules.max_stale_iterations) {
    alerts.push({
      rule: "max_stale_iterations",
      severity: "critical",
      message: `${context.staleIterations} iterations without progress. Same errors repeating.`,
      detail: { staleIterations: context.staleIterations, limit: rules.max_stale_iterations }
    });
  }

  // Rule 3: New dependencies not in task
  if (rules.no_new_dependencies_without_task && context.newDependencies?.length > 0) {
    const depsNotInTask = context.newDependencies.filter(
      dep => !context.task?.toLowerCase().includes(dep.toLowerCase())
    );
    if (depsNotInTask.length > 0) {
      alerts.push({
        rule: "no_new_dependencies_without_task",
        severity: "warn",
        message: `New dependencies added not mentioned in task: ${depsNotInTask.join(", ")}`,
        detail: { dependencies: depsNotInTask }
      });
    }
  }

  // Rule 4: Scope guard — files outside expected scope
  if (rules.scope_guard && context.outOfScopeFiles?.length > 0) {
    alerts.push({
      rule: "scope_guard",
      severity: "warn",
      message: `Files modified outside expected scope: ${context.outOfScopeFiles.join(", ")}`,
      detail: { files: context.outOfScopeFiles }
    });
  }

  // Rule 5: Reviewer overreach — reviewer consistently flags out-of-scope issues
  if (rules.reviewer_overreach && context.reviewerDemotedCount > 0) {
    const severity = context.reviewerDemotedCount >= 3 ? "critical" : "warn";
    alerts.push({
      rule: "reviewer_overreach",
      severity,
      message: `Reviewer flagged ${context.reviewerDemotedCount} out-of-scope issue(s) that were auto-demoted by scope filter.`,
      detail: { demotedCount: context.reviewerDemotedCount, autoApproved: context.reviewerAutoApproved || false }
    });
  }

  // Rule 6: Reviewer style-only block — all blocking issues are style/naming/formatting, not security/correctness
  if (rules.reviewer_style_block && context.blockingIssues?.length > 0) {
    const styleKeywords = /\b(naming|name|rename|style|format|formatting|indent|spacing|camelCase|snake_case|convention|cosmetic|readability|comment|jsdoc|documentation|whitespace|semicolon|quotes|trailing)\b/i;
    const styleSeverities = new Set(["low", "minor"]);
    const allStyle = context.blockingIssues.every(issue => {
      const desc = issue.description || "";
      const sev = (issue.severity || "").toLowerCase();
      return styleSeverities.has(sev) || styleKeywords.test(desc);
    });
    if (allStyle) {
      alerts.push({
        rule: "reviewer_style_block",
        severity: "critical",
        message: `Reviewer blocked on ${context.blockingIssues.length} style-only issue(s). Style preferences should not block approval — escalating to Solomon mediation.`,
        detail: { issueCount: context.blockingIssues.length, issues: context.blockingIssues.map(i => i.description) }
      });
    }
  }

  return {
    alerts,
    hasCritical: alerts.some(a => a.severity === "critical"),
    hasWarnings: alerts.some(a => a.severity === "warn")
  };
}

/**
 * Build context for rules evaluation from git diff and session state.
 */
export async function buildRulesContext({ session, task, iteration, blockingIssues }) {
  const context = {
    task,
    iteration,
    filesChanged: 0,
    staleIterations: 0,
    newDependencies: [],
    outOfScopeFiles: [],
    reviewerDemotedCount: 0,
    reviewerAutoApproved: false,
    blockingIssues: blockingIssues || []
  };

  // Count reviewer scope-filter demotions from session checkpoints
  const scopeFilterCheckpoints = (session.checkpoints || [])
    .filter(cp => cp.stage === "reviewer-scope-filter");
  if (scopeFilterCheckpoints.length > 0) {
    const latest = scopeFilterCheckpoints.at(-1);
    context.reviewerDemotedCount = latest.demoted_count || 0;
    context.reviewerAutoApproved = latest.auto_approved || false;
  }

  // Count files changed via git
  try {
    const { execaCommand } = await import("execa");
    const baseRef = session.session_start_sha || "HEAD~1";

    // Files changed
    const diffResult = await execaCommand(`git diff --name-only ${baseRef}`, { reject: false });
    if (diffResult.stdout) {
      const files = diffResult.stdout.split("\n").filter(Boolean);
      context.filesChanged = files.length;

      // Detect scope: config files, CI/CD, etc. that are often out of scope
      const scopePatterns = [".github/", ".gitlab-ci", "docker-compose", ".env", "firebase.json", "firestore.rules"];
      context.outOfScopeFiles = files.filter(f =>
        scopePatterns.some(pattern => f.includes(pattern))
      );

      // Detect new dependencies
      if (files.includes("package.json")) {
        try {
          const pkgDiff = await execaCommand(`git diff ${baseRef} -- package.json`, { reject: false });
          const addedDeps = (pkgDiff.stdout || "").split("\n")
            .filter(line => line.startsWith("+") && line.includes('"') && !line.startsWith("+++"))
            .map(line => {
              const match = /"([^"]+)":\s*"/.exec(line);
              return match ? match[1] : null;
            })
            .filter(Boolean)
            .filter(name => !new Set(["name", "version", "description", "main", "scripts", "type", "license", "author"]).has(name));
          context.newDependencies = addedDeps;
        } catch { /* ignore */ }
      }
    }
  } catch { /* git not available */ }

  // Count stale iterations from session checkpoints
  const checkpoints = session.checkpoints || [];
  const recentCoderCheckpoints = checkpoints
    .filter(cp => cp.stage === "coder" || cp.stage === "reviewer")
    .slice(-6); // Last 3 iterations (coder+reviewer each)

  // Simple heuristic: if last N reviewer checkpoints all have the same note/feedback, it's stale
  if (recentCoderCheckpoints.length >= 4) {
    const lastFeedbacks = checkpoints
      .filter(cp => cp.stage === "reviewer")
      .slice(-3)
      .map(cp => cp.note || "");
    const uniqueFeedbacks = new Set(lastFeedbacks);
    if (uniqueFeedbacks.size === 1 && lastFeedbacks.length >= 2) {
      context.staleIterations = lastFeedbacks.length;
    }
  }

  return context;
}

export { DEFAULT_RULES };
