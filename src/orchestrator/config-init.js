/**
 * Configuration initialization and pipeline setup helpers.
 * Extracted from orchestrator.js — pure functions, no orchestration state.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { computeBaseRef } from "../review/diff-generator.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { BudgetTracker, extractUsageMetrics } from "../utils/budget.js";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { applyPolicies } from "../guards/policy-resolver.js";
import { resolveReviewProfile } from "../review/profiles.js";
import { createSession } from "../session-store.js";

/**
 * Load product context from well-known file locations.
 */
export async function loadProductContext(projectDir) {
  const base = projectDir || process.cwd();
  const candidates = [
    path.join(base, ".karajan", "context.md"),
    path.join(base, "product-vision.md")
  ];
  for (const file of candidates) {
    try {
      const content = await fs.readFile(file, "utf8");
      return { content, source: file };
    } catch { /* not found, try next */ }
  }
  return { content: null, source: null };
}

export function resolvePipelineFlags(config) {
  return {
    plannerEnabled: Boolean(config.pipeline?.planner?.enabled),
    refactorerEnabled: Boolean(config.pipeline?.refactorer?.enabled),
    researcherEnabled: Boolean(config.pipeline?.researcher?.enabled),
    testerEnabled: Boolean(config.pipeline?.tester?.enabled),
    securityEnabled: Boolean(config.pipeline?.security?.enabled),
    impeccableEnabled: Boolean(config.pipeline?.impeccable?.enabled),
    reviewerEnabled: config.pipeline?.reviewer?.enabled !== false,
    discoverEnabled: Boolean(config.pipeline?.discover?.enabled),
    architectEnabled: Boolean(config.pipeline?.architect?.enabled),
    huReviewerEnabled: Boolean(config.pipeline?.hu_reviewer?.enabled),
  };
}

export async function handleDryRun({ task, config, flags, emitter, pipelineFlags }) {
  const { plannerEnabled, refactorerEnabled, researcherEnabled, testerEnabled, securityEnabled, impeccableEnabled, reviewerEnabled, discoverEnabled, architectEnabled, huReviewerEnabled } = pipelineFlags;
  const plannerRole = resolveRole(config, "planner");
  const coderRole = resolveRole(config, "coder");
  const reviewerRole = resolveRole(config, "reviewer");
  const refactorerRole = resolveRole(config, "refactorer");
  const triageEnabled = true;

  const dryRunPolicies = applyPolicies({
    taskType: flags.taskType || config.taskType || null,
    policies: config.policies,
  });
  const projectDir = config.projectDir || process.cwd();
  const { rules: reviewRules } = await resolveReviewProfile({ mode: config.review_mode, projectDir });
  const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));
  const coderPrompt = await buildCoderPrompt({ task, coderRules, methodology: config.development?.methodology, serenaEnabled: Boolean(config.serena?.enabled), rtkAvailable: Boolean(config.rtk?.available), proxyEnabled: Boolean(config.proxy?.enabled), productContext: config.productContext || null });
  const reviewerPrompt = await buildReviewerPrompt({ task, diff: "(dry-run: no diff)", reviewRules, mode: config.review_mode, serenaEnabled: Boolean(config.serena?.enabled), rtkAvailable: Boolean(config.rtk?.available), proxyEnabled: Boolean(config.proxy?.enabled), productContext: config.productContext || null });

  const summary = {
    dry_run: true,
    task,
    policies: dryRunPolicies,
    roles: { planner: plannerRole, coder: coderRole, reviewer: reviewerRole, refactorer: refactorerRole },
    pipeline: {
      discover_enabled: discoverEnabled,
      architect_enabled: architectEnabled,
      triage_enabled: triageEnabled,
      planner_enabled: plannerEnabled,
      refactorer_enabled: refactorerEnabled,
      sonar_enabled: Boolean(config.sonarqube?.enabled),
      reviewer_enabled: reviewerEnabled,
      researcher_enabled: researcherEnabled,
      tester_enabled: testerEnabled,
      security_enabled: securityEnabled,
      impeccable_enabled: impeccableEnabled,
      solomon_enabled: Boolean(config.pipeline?.solomon?.enabled),
      hu_reviewer_enabled: huReviewerEnabled
    },
    limits: {
      max_iterations: config.max_iterations,
      max_iteration_minutes: config.session?.max_iteration_minutes,
      max_total_minutes: config.session?.max_total_minutes,
      max_sonar_retries: config.session?.max_sonar_retries,
      max_reviewer_retries: config.session?.max_reviewer_retries,
      max_tester_retries: config.session?.max_tester_retries,
      max_security_retries: config.session?.max_security_retries
    },
    prompts: { coder: coderPrompt, reviewer: reviewerPrompt },
    git: config.git
  };

  emitProgress(
    emitter,
    makeEvent("dry-run:summary", { sessionId: null, iteration: 0, stage: "dry-run", startedAt: Date.now() }, {
      message: "Dry-run complete — no changes made",
      detail: summary
    })
  );

  return summary;
}

export function createBudgetManager({ config, emitter, eventBase }) {
  const budgetTracker = new BudgetTracker({ pricing: config?.budget?.pricing });
  const budgetLimit = Number(config?.max_budget_usd);
  const hasBudgetLimit = Number.isFinite(budgetLimit) && budgetLimit >= 0;
  const warnThresholdPct = Number(config?.budget?.warn_threshold_pct ?? 80);
  let stageCounter = 0;

  function budgetSummary() {
    const s = budgetTracker.summary();
    s.trace = budgetTracker.trace();
    return s;
  }

  function trackBudget({ role, provider, model, result, duration_ms, promptSize }) {
    const enrichedResult = promptSize && result ? { ...result, promptSize } : result;
    const metrics = extractUsageMetrics(enrichedResult, model);
    budgetTracker.record({ role, provider, ...metrics, duration_ms, stage_index: stageCounter++ });

    if (!hasBudgetLimit) return;
    const totalCost = budgetTracker.total().cost_usd;
    const pctUsed = budgetLimit === 0 ? 100 : (totalCost / budgetLimit) * 100;
    const warnOrOk = pctUsed >= warnThresholdPct ? "paused" : "ok";
    const status = totalCost > budgetLimit ? "fail" : warnOrOk;
    emitProgress(
      emitter,
      makeEvent("budget:update", { ...eventBase, stage: role }, {
        status,
        message: `Budget: $${totalCost.toFixed(2)} / $${budgetLimit.toFixed(2)}`,
        detail: {
          ...budgetSummary(),
          max_budget_usd: budgetLimit,
          warn_threshold_pct: warnThresholdPct,
          pct_used: Number(pctUsed.toFixed(2)),
          remaining_usd: budgetTracker.remaining(budgetLimit),
          executorType: "system"
        }
      })
    );
  }

  return { budgetTracker, budgetLimit, budgetSummary, trackBudget };
}

export async function initializeSession({ task, config, flags, pgTaskId, pgProject }) {
  const baseRef = await computeBaseRef({ baseBranch: config.base_branch, baseRef: flags.baseRef || null });

  if (baseRef === "__snapshot__") {
    const { takeSnapshot } = await import("../review/snapshot-diff.js");
    const { setSnapshot } = await import("../review/diff-generator.js");
    const snapshot = await takeSnapshot(config.projectDir || process.cwd());
    setSnapshot(snapshot);
  }

  const sessionInit = {
    task,
    config_snapshot: config,
    base_ref: baseRef,
    session_start_sha: baseRef,
    last_reviewer_feedback: null,
    repeated_issue_count: 0,
    sonar_retry_count: 0,
    reviewer_retry_count: 0,
    standby_retry_count: 0,
    last_sonar_issue_signature: null,
    sonar_repeat_count: 0,
    last_reviewer_issue_signature: null,
    reviewer_repeat_count: 0,
    deferred_issues: []
  };
  if (pgTaskId) sessionInit.pg_task_id = pgTaskId;
  if (pgProject) sessionInit.pg_project_id = pgProject;
  return createSession(sessionInit);
}

export function applyTriageOverrides(pipelineFlags, roleOverrides) {
  const keys = ["plannerEnabled", "researcherEnabled", "architectEnabled", "refactorerEnabled", "reviewerEnabled", "testerEnabled", "securityEnabled", "impeccableEnabled"];
  for (const key of keys) {
    if (roleOverrides[key] !== undefined) {
      pipelineFlags[key] = roleOverrides[key];
    }
  }
}

const SIMPLE_LEVELS = new Set(["trivial", "simple"]);

export function applyAutoSimplify({ pipelineFlags, triageLevel, config, flags, logger, emitter, eventBase }) {
  if (!config.pipeline?.auto_simplify) return false;
  if (!triageLevel || !SIMPLE_LEVELS.has(triageLevel)) return false;
  if (flags.mode) return false;
  if (flags.enableReviewer !== undefined || flags.enableTester !== undefined) return false;

  pipelineFlags.reviewerEnabled = false;
  pipelineFlags.testerEnabled = false;

  const disabledRoles = ["reviewer", "tester"];
  logger.info(`Simple task (${triageLevel}) — lightweight pipeline (disabled: ${disabledRoles.join(", ")})`);
  emitProgress(
    emitter,
    makeEvent("pipeline:simplify", { ...eventBase, stage: "triage" }, {
      message: `Simple task (${triageLevel}) — lightweight pipeline`,
      detail: { level: triageLevel, disabledRoles }
    })
  );
  return true;
}

export function applyFlagOverrides(pipelineFlags, flags) {
  if (flags.enablePlanner !== undefined) pipelineFlags.plannerEnabled = Boolean(flags.enablePlanner);
  if (flags.enableResearcher !== undefined) pipelineFlags.researcherEnabled = Boolean(flags.enableResearcher);
  if (flags.enableArchitect !== undefined) pipelineFlags.architectEnabled = Boolean(flags.enableArchitect);
  if (flags.enableRefactorer !== undefined) pipelineFlags.refactorerEnabled = Boolean(flags.enableRefactorer);
  if (flags.enableReviewer !== undefined) pipelineFlags.reviewerEnabled = Boolean(flags.enableReviewer);
  if (flags.enableTester !== undefined) pipelineFlags.testerEnabled = Boolean(flags.enableTester);
  if (flags.enableSecurity !== undefined) pipelineFlags.securityEnabled = Boolean(flags.enableSecurity);
  if (flags.enableImpeccable !== undefined) pipelineFlags.impeccableEnabled = Boolean(flags.enableImpeccable);

  if (flags.design) {
    pipelineFlags.impeccableEnabled = true;
    pipelineFlags.impeccableMode = "refactoring";
  }
}

export function resolvePipelinePolicies({ flags, config, stageResults, emitter, eventBase, session, pipelineFlags }) {
  const resolvedPolicies = applyPolicies({
    taskType: flags.taskType || config.taskType || stageResults.triage?.taskType || stageResults.intent?.taskType || null,
    policies: config.policies,
  });
  session.resolved_policies = resolvedPolicies;

  let updatedConfig = config;
  if (!resolvedPolicies.tdd) {
    updatedConfig = { ...updatedConfig, development: { ...updatedConfig.development, methodology: "standard", require_test_changes: false } };
  }
  if (!resolvedPolicies.sonar) {
    updatedConfig = { ...updatedConfig, sonarqube: { ...updatedConfig.sonarqube, enabled: false } };
  }
  if (!resolvedPolicies.reviewer) {
    pipelineFlags.reviewerEnabled = false;
  }
  if (resolvedPolicies.coderRequired === false) {
    pipelineFlags.coderRequired = false;
  }

  emitProgress(
    emitter,
    makeEvent("policies:resolved", eventBase, {
      message: `Policies resolved for taskType="${resolvedPolicies.taskType}"`,
      detail: resolvedPolicies
    })
  );

  return updatedConfig;
}
