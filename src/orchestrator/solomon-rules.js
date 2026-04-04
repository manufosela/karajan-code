/**
 * Solomon rules engine — detects anomalies during session execution.
 * Each rule returns { triggered: boolean, severity: "warn"|"critical", message, detail }
 */

const DEFAULT_RULES = {
  max_stale_iterations: 3,
  no_new_dependencies_without_task: true,
  scope_guard: true,
  reviewer_overreach: true,
  reviewer_style_block: true
};

export function evaluateRules(context, rulesConfig = {}) {
  const rules = { ...DEFAULT_RULES, ...rulesConfig };
  const alerts = [];

  // Rule 1: Stale iterations (no progress)
  if (rules.max_stale_iterations && context.staleIterations >= rules.max_stale_iterations) {
    alerts.push({
      rule: "max_stale_iterations",
      severity: "critical",
      message: `${context.staleIterations} iterations without progress. Same errors repeating.`,
      detail: { staleIterations: context.staleIterations, limit: rules.max_stale_iterations }
    });
  }

  // Rule 3: New dependencies not in task (only flag suspicious runtime deps, not dev/test tooling)
  if (rules.no_new_dependencies_without_task && context.newDependencies?.length > 0) {
    const testTooling = /vitest|jest|mocha|coverage|eslint|prettier|typescript|@types\//i;
    const buildTooling = /webpack|vite|rollup|esbuild|tsup|unbuild/i;
    const depsNotInTask = context.newDependencies.filter(dep => {
      if (testTooling.test(dep) || buildTooling.test(dep)) return false;
      if (dep.startsWith("dev:") || dep.startsWith("@vitest/") || dep.startsWith("@types/")) return false;
      return !context.task?.toLowerCase().includes(dep.toLowerCase());
    });
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
      // Exclude .env.example (legitimate for new projects) and files within projectDir
      const scopePatterns = [".github/", ".gitlab-ci", "docker-compose", "firebase.json", "firestore.rules"];
      const projectDir = session?.config_snapshot?.projectDir || null;
      context.outOfScopeFiles = files.filter(f => {
        // Files inside projectDir are always in scope
        if (projectDir && f.startsWith(projectDir.replace(/^\.\//, ""))) return false;
        // .env (but not .env.example) is out of scope
        if (f.endsWith(".env") && !f.endsWith(".env.example")) return true;
        return scopePatterns.some(pattern => f.includes(pattern));
      });

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
  // "Stale" means TRULY no progress: same exact feedback AND zero files changed
  const checkpoints = session.checkpoints || [];
  const reviewerCps = checkpoints.filter(cp => cp.stage === "reviewer").slice(-3);
  const coderCps = checkpoints.filter(cp => cp.stage === "coder").slice(-3);

  if (reviewerCps.length >= 3) {
    const feedbacks = reviewerCps.map(cp => cp.note || "");
    const uniqueFeedbacks = new Set(feedbacks);
    const filesChanged = coderCps.some(cp => (cp.filesChanged || 0) > 0);

    // Only stale if feedback is identical AND no files changed
    if (uniqueFeedbacks.size === 1 && !filesChanged) {
      context.staleIterations = reviewerCps.length;
    }
    // If issues are changing between iterations, there IS progress
  }

  return context;
}

export { DEFAULT_RULES };
