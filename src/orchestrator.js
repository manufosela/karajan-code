import fs from "node:fs/promises";
import path from "node:path";
import { createAgent } from "./agents/index.js";
import {
  createSession,
  loadSession,
  markSessionStatus,
  pauseSession,
  resumeSessionWithAnswer,
  saveSession,
  addCheckpoint
} from "./session-store.js";
import { computeBaseRef, generateDiff } from "./review/diff-generator.js";
import { buildCoderPrompt } from "./prompts/coder.js";
import { buildReviewerPrompt } from "./prompts/reviewer.js";
import { resolveRole } from "./config.js";
import { RepeatDetector, getRepeatThreshold } from "./repeat-detector.js";
import { emitProgress, makeEvent } from "./utils/events.js";
import { BudgetTracker, extractUsageMetrics } from "./utils/budget.js";
import {
  prepareGitAutomation,
  finalizeGitAutomation,
  earlyPrCreation,
  incrementalPush
} from "./git/automation.js";
import { resolveRoleMdPath, loadFirstExisting } from "./roles/base-role.js";
import { applyPolicies } from "./guards/policy-resolver.js";
import { scanDiff } from "./guards/output-guard.js";
import { scanPerfDiff } from "./guards/perf-guard.js";
import { classifyIntent } from "./guards/intent-guard.js";
import { resolveReviewProfile } from "./review/profiles.js";
import { CoderRole } from "./roles/coder-role.js";
import { invokeSolomon } from "./orchestrator/solomon-escalation.js";
import { msg, getLang } from "./utils/messages.js";
import { PipelineContext } from "./orchestrator/pipeline-context.js";
import { runTriageStage, runResearcherStage, runArchitectStage, runPlannerStage, runDiscoverStage, runHuReviewerStage } from "./orchestrator/pre-loop-stages.js";
import { runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runSonarCloudStage, runReviewerStage } from "./orchestrator/iteration-stages.js";
import { runTesterStage, runSecurityStage, runImpeccableStage, runFinalAuditStage } from "./orchestrator/post-loop-stages.js";
import { needsSubPipeline, runHuSubPipeline } from "./orchestrator/hu-sub-pipeline.js";
import { waitForCooldown, MAX_STANDBY_RETRIES } from "./orchestrator/standby.js";
import { detectTestFramework } from "./utils/project-detect.js";
import { runPreflightChecks } from "./orchestrator/preflight-checks.js";
import { detectRtk } from "./utils/rtk-detect.js";
import { createRtkRunner, RtkSavingsTracker } from "./utils/rtk-wrapper.js";
import { setRunner as setDiffRunner } from "./review/diff-generator.js";
import { setRunner as setGitRunner } from "./utils/git.js";
import { detectNeededSkills, autoInstallSkills, cleanupAutoInstalledSkills } from "./skills/skill-detector.js";
import { isOpenSkillsAvailable } from "./skills/openskills-client.js";


// --- Product Context loader ---

/**
 * Load product context from well-known file locations.
 * Returns the file content or null if no file is found.
 * @param {string|null} projectDir
 * @returns {Promise<{content: string|null, source: string|null}>}
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

// --- Extracted helper functions (pure refactoring, zero behavior change) ---

function resolvePipelineFlags(config) {
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

async function handleDryRun({ task, config, flags, emitter, pipelineFlags }) {
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
  const coderPrompt = await buildCoderPrompt({ task, coderRules, methodology: config.development?.methodology, serenaEnabled: Boolean(config.serena?.enabled), rtkAvailable: Boolean(config.rtk?.available), productContext: config.productContext || null });
  const reviewerPrompt = await buildReviewerPrompt({ task, diff: "(dry-run: no diff)", reviewRules, mode: config.review_mode, serenaEnabled: Boolean(config.serena?.enabled), rtkAvailable: Boolean(config.rtk?.available), productContext: config.productContext || null });

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

function createBudgetManager({ config, emitter, eventBase }) {
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
    // Attach promptSize to result if provided, so extractUsageMetrics can estimate tokens
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

async function initializeSession({ task, config, flags, pgTaskId, pgProject }) {
  const baseRef = await computeBaseRef({ baseBranch: config.base_branch, baseRef: flags.baseRef || null });
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

// PG card "In Progress" logic moved to src/planning-game/pipeline-adapter.js → initPgAdapter()

function applyTriageOverrides(pipelineFlags, roleOverrides) {
  const keys = ["plannerEnabled", "researcherEnabled", "architectEnabled", "refactorerEnabled", "reviewerEnabled", "testerEnabled", "securityEnabled", "impeccableEnabled"];
  for (const key of keys) {
    if (roleOverrides[key] !== undefined) {
      pipelineFlags[key] = roleOverrides[key];
    }
  }
}

const SIMPLE_LEVELS = new Set(["trivial", "simple"]);

function applyAutoSimplify({ pipelineFlags, triageLevel, config, flags, logger, emitter, eventBase }) {
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

// PG decomposition logic moved to src/planning-game/pipeline-adapter.js → handlePgDecomposition()

function applyFlagOverrides(pipelineFlags, flags) {
  if (flags.enablePlanner !== undefined) pipelineFlags.plannerEnabled = Boolean(flags.enablePlanner);
  if (flags.enableResearcher !== undefined) pipelineFlags.researcherEnabled = Boolean(flags.enableResearcher);
  if (flags.enableArchitect !== undefined) pipelineFlags.architectEnabled = Boolean(flags.enableArchitect);
  if (flags.enableRefactorer !== undefined) pipelineFlags.refactorerEnabled = Boolean(flags.enableRefactorer);
  if (flags.enableReviewer !== undefined) pipelineFlags.reviewerEnabled = Boolean(flags.enableReviewer);
  if (flags.enableTester !== undefined) pipelineFlags.testerEnabled = Boolean(flags.enableTester);
  if (flags.enableSecurity !== undefined) pipelineFlags.securityEnabled = Boolean(flags.enableSecurity);
  if (flags.enableImpeccable !== undefined) pipelineFlags.impeccableEnabled = Boolean(flags.enableImpeccable);
}

function resolvePipelinePolicies({ flags, config, stageResults, emitter, eventBase, session, pipelineFlags }) {
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

async function runPlanningPhases({ config, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion }) {
  let researchContext = null;
  let plannedTask = task;

  if (pipelineFlags.researcherEnabled) {
    const researcherResult = await runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    researchContext = researcherResult.researchContext;
    stageResults.researcher = researcherResult.stageResult;
  }

  // --- Architect (between researcher and planner) ---
  let architectContext = null;
  if (pipelineFlags.architectEnabled) {
    const architectResult = await runArchitectStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      researchContext,
      discoverResult: stageResults.discover || null,
      triageLevel: stageResults.triage?.level || null,
      askQuestion
    });
    architectContext = architectResult.architectContext;
    stageResults.architect = architectResult.stageResult;
  }

  const triageDecomposition = stageResults.triage?.shouldDecompose ? stageResults.triage.subtasks : null;
  if (pipelineFlags.plannerEnabled) {
    const plannerRole = resolveRole(config, "planner");
    const plannerResult = await runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, architectContext, triageDecomposition, trackBudget });
    plannedTask = plannerResult.plannedTask;
    stageResults.planner = plannerResult.stageResult;

    await tryBecariaComment({
      config, session, logger,
      agent: "Planner",
      body: `Plan: ${plannerResult.stageResult?.summary || plannedTask}`
    });
  }

  return { plannedTask };
}

async function tryBecariaComment({ config, session, logger, agent, body }) {
  if (!config.becaria?.enabled || !session.becaria_pr_number) return;
  try {
    const { dispatchComment } = await import("./becaria/dispatch.js");
    const { detectRepo } = await import("./becaria/repo.js");
    const repo = await detectRepo();
    if (repo) {
      await dispatchComment({
        repo, prNumber: session.becaria_pr_number, agent,
        body, becariaConfig: config.becaria
      });
    }
  } catch { /* non-blocking */ }
}

function detectCheckpointProgress(session, lastCheckpointSnapshot) {
  if (!lastCheckpointSnapshot) return true; // First checkpoint — assume progress
  const currentIteration = session.reviewer_retry_count ?? 0;
  const currentStages = Object.keys(session.resolved_policies || {}).length;
  const currentCheckpoints = (session.checkpoints || []).length;

  const iterationAdvanced = currentIteration !== lastCheckpointSnapshot.iteration;
  const stagesChanged = currentStages !== lastCheckpointSnapshot.stagesCount;
  const checkpointsChanged = currentCheckpoints !== lastCheckpointSnapshot.checkpointsCount;

  return iterationAdvanced || stagesChanged || checkpointsChanged;
}

function takeCheckpointSnapshot(session) {
  return {
    iteration: session.reviewer_retry_count ?? 0,
    stagesCount: Object.keys(session.resolved_policies || {}).length,
    checkpointsCount: (session.checkpoints || []).length
  };
}

async function handleCheckpoint({ checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes, i, config, budgetTracker, stageResults, emitter, eventBase, session, budgetSummary, lastCheckpointSnapshot }) {
  if (checkpointDisabled || !askQuestion || (Date.now() - lastCheckpointAt) < checkpointIntervalMs) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt, lastCheckpointSnapshot };
  }

  const elapsedStr = elapsedMinutes.toFixed(1);
  const stagesCompleted = Object.keys(stageResults).join(", ") || "none";

  // Auto-continue if progress detected since last checkpoint
  const hasProgress = detectCheckpointProgress(session, lastCheckpointSnapshot);
  const newSnapshot = takeCheckpointSnapshot(session);

  if (hasProgress) {
    emitProgress(
      emitter,
      makeEvent("session:checkpoint", { ...eventBase, iteration: i, stage: "checkpoint" }, {
        message: `Checkpoint: progress detected, continuing (${elapsedStr} min elapsed)`,
        detail: { elapsed_minutes: Number(elapsedStr), iterations_done: i - 1, stages: stagesCompleted, auto_continued: true, executorType: "system" }
      })
    );
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now(), lastCheckpointSnapshot: newSnapshot };
  }

  // No progress — ask human
  const iterInfo = `${i - 1}/${config.max_iterations} iterations completed`;
  const budgetInfo = budgetTracker.total().cost_usd > 0 ? ` | Budget: $${budgetTracker.total().cost_usd.toFixed(2)}` : "";
  const checkpointMsg = `Checkpoint — ${elapsedStr} min elapsed | ${iterInfo}${budgetInfo} | Stages completed: ${stagesCompleted}. No progress since last checkpoint. What would you like to do?`;

  emitProgress(
    emitter,
    makeEvent("session:checkpoint", { ...eventBase, iteration: i, stage: "checkpoint" }, {
      message: `Interactive checkpoint at ${elapsedStr} min (stalled)`,
      detail: { elapsed_minutes: Number(elapsedStr), iterations_done: i - 1, stages: stagesCompleted, auto_continued: false }
    })
  );

  const lang = getLang(config);
  const answer = await askQuestion(
    `${checkpointMsg}\n\n${msg("checkpoint_options", lang)}`
  );

  await addCheckpoint(session, { stage: "interactive-checkpoint", elapsed_minutes: Number(elapsedStr), answer });

  const trimmedAnswer = (answer || "").trim();
  const isExplicitStop = trimmedAnswer === "4" || trimmedAnswer.toLowerCase().startsWith("stop");

  if (isExplicitStop) {
    await markSessionStatus(session, "stopped");
    emitProgress(
      emitter,
      makeEvent("session:end", { ...eventBase, iteration: i, stage: "user-stop" }, {
        status: "stopped",
        message: "Session stopped by user at checkpoint",
        detail: { approved: false, reason: "user_stopped", elapsed_minutes: Number(elapsedStr), budget: budgetSummary() }
      })
    );
    return { action: "stop", result: { approved: false, sessionId: session.id, reason: "user_stopped", elapsed_minutes: Number(elapsedStr) } };
  }

  const parsed = parseCheckpointAnswer({ trimmedAnswer, checkpointDisabled, config });
  parsed.lastCheckpointSnapshot = newSnapshot;
  return parsed;
}

export function parseCheckpointAnswer({ trimmedAnswer, checkpointDisabled, config }) {
  if (!trimmedAnswer) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  if (trimmedAnswer === "2" || trimmedAnswer.toLowerCase().startsWith("continue until")) {
    return { action: "continue_loop", checkpointDisabled: true, lastCheckpointAt: Date.now() };
  }
  if (trimmedAnswer === "1" || trimmedAnswer.toLowerCase().includes("5 m")) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  const customMinutes = Number.parseInt(trimmedAnswer.replaceAll(/\D/g, ""), 10);
  if (customMinutes > 0) {
    config.session.checkpoint_interval_minutes = customMinutes;
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
}

async function checkSessionTimeout({ askQuestion, elapsedMinutes, config, session, emitter, eventBase, i, budgetSummary }) {
  if (askQuestion || elapsedMinutes <= config.session.max_total_minutes) return;

  await markSessionStatus(session, "failed");
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, iteration: i, stage: "timeout" }, {
      status: "fail",
      message: "Session timed out",
      detail: { approved: false, reason: "timeout", budget: budgetSummary() }
    })
  );
  throw new Error("Session timed out");
}

async function checkBudgetExceeded({ budgetTracker, config, session, emitter, eventBase, i, budgetLimit, budgetSummary }) {
  if (!budgetTracker.isOverBudget(config?.max_budget_usd)) return;

  await markSessionStatus(session, "failed");
  const totalCost = budgetTracker.total().cost_usd;
  const message = `Budget exceeded: $${totalCost.toFixed(2)} > $${budgetLimit.toFixed(2)}`;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, iteration: i, stage: "budget" }, {
      status: "fail",
      message,
      detail: { approved: false, reason: "budget_exceeded", budget: budgetSummary(), max_budget_usd: budgetLimit }
    })
  );
  throw new Error(message);
}

async function handleStandbyResult({ stageResult, session, emitter, eventBase, i, stage, logger }) {
  if (stageResult?.action !== "standby") {
    return { handled: false };
  }

  const standbyRetries = session.standby_retry_count || 0;
  const isOutage = stageResult.standbyInfo.isProviderOutage;
  const pauseReason = isOutage
    ? `Provider outage (${stageResult.standbyInfo.message || "5xx/connection error"}) — retried ${standbyRetries} times. This is NOT a KJ or code problem.`
    : `Rate limit standby exhausted after ${standbyRetries} retries. Agent: ${stageResult.standbyInfo.agent}`;

  if (standbyRetries >= MAX_STANDBY_RETRIES) {
    session.last_reviewer_feedback = isOutage
      ? "IMPORTANT: The previous interruption was caused by a provider outage (API 500 error), NOT by a problem in your code or in Karajan. Continue from where you left off."
      : session.last_reviewer_feedback;
    await pauseSession(session, {
      question: pauseReason,
      context: { iteration: i, stage, reason: isOutage ? "provider_outage" : "standby_exhausted" }
    });
    emitProgress(emitter, makeEvent(`${stage}:rate_limit`, { ...eventBase, stage }, {
      status: "paused",
      message: `Standby exhausted after ${standbyRetries} retries`,
      detail: { agent: stageResult.standbyInfo.agent, sessionId: session.id }
    }));
    return {
      handled: true,
      action: "return",
      result: { paused: true, sessionId: session.id, question: `Rate limit standby exhausted after ${standbyRetries} retries`, context: "standby_exhausted" }
    };
  }
  session.standby_retry_count = standbyRetries + 1;
  await saveSession(session);
  await waitForCooldown({ ...stageResult.standbyInfo, retryCount: standbyRetries, emitter, eventBase, logger, session });
  return { handled: true, action: "retry" };
}

function formatCommitList(commits) {
  return commits.map((c) => `- \`${c.hash.slice(0, 7)}\` ${c.message}`).join("\n");
}

async function becariaIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment }) {
  const pushResult = await incrementalPush({ gitCtx, task, logger, session });
  if (!pushResult) return;

  // Accumulate commits for PG card lifecycle tracking
  const { accumulateCommit } = await import("./planning-game/pipeline-adapter.js");
  for (const c of pushResult.commits) accumulateCommit(session, c);

  session.becaria_commits = [...(session.becaria_commits ?? []), ...pushResult.commits];
  await saveSession(session);

  if (!repo) return;
  const feedback = session.last_reviewer_feedback || "N/A";
  await dispatchComment({
    repo, prNumber: session.becaria_pr_number, agent: "Coder",
    body: `Issues corregidos:\n${feedback}\n\nCommits:\n${formatCommitList(pushResult.commits)}`,
    becariaConfig: config.becaria
  });
}

async function becariaCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment }) {
  const earlyPr = await earlyPrCreation({ gitCtx, task, logger, session, stageResults });
  if (!earlyPr) return;

  // Accumulate commits for PG card lifecycle tracking
  const { accumulateCommit } = await import("./planning-game/pipeline-adapter.js");
  for (const c of earlyPr.commits) accumulateCommit(session, c);

  session.becaria_pr_number = earlyPr.prNumber;
  session.becaria_pr_url = earlyPr.prUrl;
  session.becaria_commits = earlyPr.commits;
  await saveSession(session);
  emitProgress(emitter, makeEvent("becaria:pr-created", { ...eventBase, stage: "becaria" }, {
    message: `Early PR created: #${earlyPr.prNumber}`,
    detail: { prNumber: earlyPr.prNumber, prUrl: earlyPr.prUrl }
  }));

  if (!repo) return;
  await dispatchComment({
    repo, prNumber: earlyPr.prNumber, agent: "Coder",
    body: `Iteración ${i} completada.\n\nCommits:\n${formatCommitList(earlyPr.commits)}`,
    becariaConfig: config.becaria
  });
}

async function handleBecariaEarlyPrOrPush({ becariaEnabled, config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i }) {
  if (!becariaEnabled) return;

  try {
    const { dispatchComment } = await import("./becaria/dispatch.js");
    const { detectRepo } = await import("./becaria/repo.js");
    const repo = await detectRepo();

    if (session.becaria_pr_number) {
      await becariaIncrementalPush({ config, session, gitCtx, task, logger, repo, dispatchComment });
    } else {
      await becariaCreateEarlyPr({ config, session, emitter, eventBase, gitCtx, task, logger, stageResults, i, repo, dispatchComment });
    }
  } catch (err) {
    logger.warn(`BecarIA early PR/push failed (non-blocking): ${err.message}`);
  }
}

function emitSolomonAlerts(alerts, emitter, eventBase, logger) {
  for (const alert of alerts) {
    emitProgress(emitter, makeEvent("solomon:alert", { ...eventBase, stage: "solomon" }, {
      status: alert.severity === "critical" ? "fail" : "warn",
      message: alert.message,
      detail: alert.detail
    }));
    logger.warn(`Solomon alert [${alert.rule}]: ${alert.message}`);
  }
}

async function handleSolomonCheck({ config, session, emitter, eventBase, logger, task, i, askQuestion, becariaEnabled, blockingIssues }) {
  if (config.pipeline?.solomon?.enabled === false) return { action: "continue" };

  try {
    const { evaluateRules, buildRulesContext } = await import("./orchestrator/solomon-rules.js");
    const rulesContext = await buildRulesContext({ session, task, iteration: i, blockingIssues });
    const rulesResult = evaluateRules(rulesContext, config.solomon?.rules);

    if (rulesResult.alerts.length > 0) {
      emitSolomonAlerts(rulesResult.alerts, emitter, eventBase, logger);
      const pauseResult = await checkSolomonCriticalAlerts({ rulesResult, askQuestion, session, i });
      if (pauseResult) return pauseResult;
    }

    if (becariaEnabled && session.becaria_pr_number) {
      const alerts = rulesResult.alerts || [];
      const alertMsg = alerts.length > 0
        ? alerts.map(a => `- [${a.severity}] ${a.message}`).join("\n")
        : "No anomalies detected";
      await tryBecariaComment({
        config, session, logger,
        agent: "Solomon",
        body: `Supervisor check iteración ${i}: ${alertMsg}`
      });
    }
  } catch (err) {
    logger.warn(`Solomon rules evaluation failed: ${err.message}`);
  }

  return { action: "continue" };
}

async function checkSolomonCriticalAlerts({ rulesResult, askQuestion, session, i }) {
  if (!rulesResult.hasCritical || !askQuestion) return null;

  const alertSummary = rulesResult.alerts
    .filter(a => a.severity === "critical")
    .map(a => a.message)
    .join("\n");
  const question = [
    "Solomon detected critical issues:",
    alertSummary,
    "",
    "What should we do?",
    "1 = Continue anyway",
    "2 = Pause the session",
    "3 = Stop the session",
    "",
    "Type 1, 2, or 3:"
  ].join("\n");
  const answer = await askQuestion(question, { iteration: i, stage: "solomon" });
  const trimmed = (answer || "").trim().toLowerCase();
  const shouldPause = !answer
    || trimmed === "2" || trimmed === "3"
    || trimmed.startsWith("pause") || trimmed.startsWith("stop");
  if (shouldPause) {
    await pauseSession(session, {
      question: `Solomon supervisor paused: ${alertSummary}`,
      context: { iteration: i, stage: "solomon", alerts: rulesResult.alerts }
    });
    return { action: "pause", result: { paused: true, sessionId: session.id, reason: "solomon_alert" } };
  }
  return null;
}

function formatBlockingIssues(issues) {
  return issues?.map((x) => `- ${x.id || "ISSUE"} [${x.severity || ""}] ${x.description}`).join("\n") || "";
}

function formatSuggestions(suggestions) {
  return suggestions?.map((s) => {
    const detail = typeof s === "string" ? s : `${s.id || ""} ${s.description || s}`;
    return `- ${detail}`;
  }).join("\n") || "";
}

function buildReviewCommentBody(review, i) {
  const status = review.approved ? "APPROVED" : "REQUEST_CHANGES";
  const blocking = formatBlockingIssues(review.blocking_issues);
  const suggestions = formatSuggestions(review.non_blocking_suggestions);
  let body = `Review iteración ${i}: ${status}`;
  if (blocking) body += `\n\n**Blocking:**\n${blocking}`;
  if (suggestions) body += `\n\n**Suggestions:**\n${suggestions}`;
  return body;
}

async function handleBecariaReviewDispatch({ becariaEnabled, config, session, review, i, logger }) {
  if (!becariaEnabled || !session.becaria_pr_number) return;

  try {
    const { dispatchReview, dispatchComment } = await import("./becaria/dispatch.js");
    const { detectRepo } = await import("./becaria/repo.js");
    const repo = await detectRepo();
    if (!repo) return;

    const bc = config.becaria;
    const reviewEvent = review.approved ? "APPROVE" : "REQUEST_CHANGES";
    const reviewBody = review.approved
      ? (review.summary || "Approved")
      : (formatBlockingIssues(review.blocking_issues) || review.summary || "Changes requested");

    await dispatchReview({
      repo, prNumber: session.becaria_pr_number,
      event: reviewEvent, body: reviewBody, agent: "Reviewer", becariaConfig: bc
    });

    await dispatchComment({
      repo, prNumber: session.becaria_pr_number, agent: "Reviewer",
      body: buildReviewCommentBody(review, i), becariaConfig: bc
    });

    logger.info(`BecarIA: dispatched review for PR #${session.becaria_pr_number}`);
  } catch (err) {
    logger.warn(`BecarIA dispatch failed (non-blocking): ${err.message}`);
  }
}

async function handlePostLoopStages({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, becariaEnabled, testerEnabled, securityEnabled, askQuestion, logger }) {
  const postLoopDiff = await generateDiff({ baseRef: session.session_start_sha });

  if (testerEnabled) {
    const testerResult = await runTesterStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion
    });
    if (testerResult.action === "pause") return { action: "return", result: testerResult.result };
    if (testerResult.action === "continue") return { action: "continue" };
    if (testerResult.stageResult) {
      stageResults.tester = testerResult.stageResult;
      await tryBecariaComment({ config, session, logger, agent: "Tester", body: `Tests: ${testerResult.stageResult.summary || "completed"}` });
    }
  }

  if (securityEnabled) {
    const securityResult = await runSecurityStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion
    });
    if (securityResult.action === "pause") return { action: "return", result: securityResult.result };
    if (securityResult.action === "continue") return { action: "continue" };
    if (securityResult.stageResult) {
      stageResults.security = securityResult.stageResult;
      await tryBecariaComment({ config, session, logger, agent: "Security", body: `Security scan: ${securityResult.stageResult.summary || "completed"}` });
    }
  }

  // Final audit — last quality gate before declaring success
  const auditResult = await runFinalAuditStage({
    config, logger, emitter, eventBase, session, coderRole, trackBudget,
    iteration: i, task, diff: postLoopDiff
  });
  if (auditResult.stageResult) {
    stageResults.audit = auditResult.stageResult;
    await tryBecariaComment({ config, session, logger, agent: "Audit", body: `Final audit: ${auditResult.stageResult.summary || "completed"}` });
  }
  if (auditResult.action === "retry") {
    // Audit found actionable issues — loop back to coder
    session.last_reviewer_feedback = auditResult.feedback;
    await saveSession(session);
    return { action: "continue" };
  }

  return { action: "proceed" };
}

async function finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker }) {
  const gitResult = await finalizeGitAutomation({ config, gitCtx, task, logger, session, stageResults });

  // Accumulate final commits for PG card lifecycle tracking
  if (gitResult?.commits?.length) {
    const { accumulateCommit } = await import("./planning-game/pipeline-adapter.js");
    for (const c of gitResult.commits) accumulateCommit(session, c);
  }

  if (stageResults.planner?.ok) {
    stageResults.planner.completedSteps = [...(stageResults.planner.steps ?? [])];
  }
  session.budget = budgetSummary();
  await markSessionStatus(session, "approved");

  const { markPgCardToValidate } = await import("./planning-game/pipeline-adapter.js");
  await markPgCardToValidate({ pgCard, pgProject, config, session, gitResult, logger });

  const deferredIssues = session.deferred_issues || [];
  const rtkSavings = rtkTracker?.hasData() ? rtkTracker.summary() : undefined;
  if (rtkSavings) session.rtk_savings = rtkSavings;
  await saveSession(session);

  const endDetail = { approved: true, iterations: i, stages: stageResults, git: gitResult, budget: budgetSummary(), deferredIssues };
  if (rtkSavings) endDetail.rtk_savings = rtkSavings;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      message: deferredIssues.length > 0
        ? `Session approved (${deferredIssues.length} deferred issue(s) tracked as tech debt)`
        : "Session approved",
      detail: endDetail
    })
  );
  const result = { approved: true, sessionId: session.id, review, git: gitResult, deferredIssues };
  if (rtkSavings) result.rtk_savings = rtkSavings;
  return result;
}

// PG card "To Validate" logic moved to src/planning-game/pipeline-adapter.js → markPgCardToValidate()

async function handleReviewerRetryAndSolomon({ config, session, emitter, eventBase, logger, review, task, i, askQuestion }) {
  session.last_reviewer_feedback = review.blocking_issues
    .map((x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`)
    .join("\n");
  session.reviewer_retry_count = (session.reviewer_retry_count || 0) + 1;
  await saveSession(session);

  const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
  if (session.reviewer_retry_count < maxReviewerRetries) {
    return { action: "continue" };
  }

  emitProgress(
    emitter,
    makeEvent("solomon:escalate", { ...eventBase, stage: "reviewer" }, {
      message: `Reviewer sub-loop limit reached (${session.reviewer_retry_count}/${maxReviewerRetries})`,
      detail: { subloop: "reviewer", retryCount: session.reviewer_retry_count, limit: maxReviewerRetries }
    })
  );

  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "reviewer", askQuestion, session, iteration: i,
    conflict: {
      stage: "reviewer",
      task,
      iterationCount: session.reviewer_retry_count,
      maxIterations: maxReviewerRetries,
      history: [{ agent: "reviewer", feedback: session.last_reviewer_feedback }]
    }
  });

  if (solomonResult.action === "pause") {
    return { action: "return", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "reviewer_fail_fast" } };
  }
  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
    }
    session.reviewer_retry_count = 0;
    await saveSession(session);
    return { action: "continue" };
  }
  if (solomonResult.action === "subtask") {
    return { action: "return", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "reviewer_subtask" } };
  }

  return { action: "continue" };
}


async function runPreLoopStages({ config, logger, emitter, eventBase, session, flags, pipelineFlags, coderRole, trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults }) {
  // --- HU Reviewer (first stage, before everything else, opt-in) ---
  const huFile = flags.huFile || null;
  if (flags.enableHuReviewer !== undefined) pipelineFlags.huReviewerEnabled = Boolean(flags.enableHuReviewer);
  if (pipelineFlags.huReviewerEnabled && huFile) {
    const huResult = await runHuReviewerStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, huFile, askQuestion, pgStories: null });
    stageResults.huReviewer = huResult.stageResult;
  }

  // --- Intent classifier (deterministic pre-triage, opt-in) ---
  if (config.guards?.intent?.enabled) {
    const intentResult = classifyIntent(task, config);
    stageResults.intent = intentResult;
    if (intentResult.classified) {
      emitProgress(emitter, makeEvent("intent:classified", { ...eventBase, stage: "intent" }, {
        message: `Intent classified: ${intentResult.taskType} (${intentResult.level}) — ${intentResult.message}`,
        detail: intentResult
      }));
    }
  }

  // --- Discover (pre-triage, opt-in) ---
  if (flags.enableDiscover !== undefined) pipelineFlags.discoverEnabled = Boolean(flags.enableDiscover);
  if (pipelineFlags.discoverEnabled) {
    const discoverResult = await runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    stageResults.discover = discoverResult.stageResult;
  }

  // --- Triage (always on) ---
  const triageResult = await runTriageStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
  applyTriageOverrides(pipelineFlags, triageResult.roleOverrides);
  stageResults.triage = triageResult.stageResult;

  // --- Auto-install skills based on task + project detection ---
  const projectDir = config.projectDir || process.cwd();
  try {
    const osAvailable = await isOpenSkillsAvailable();
    if (osAvailable) {
      const neededSkills = await detectNeededSkills(task, projectDir);
      if (neededSkills.length > 0) {
        const skillResult = await autoInstallSkills(neededSkills, projectDir);
        if (skillResult.installed.length > 0) {
          session.autoInstalledSkills = skillResult.installed;
        }
        emitProgress(emitter, makeEvent("skills:auto-install", { ...eventBase, stage: "triage" }, {
          message: skillResult.installed.length > 0
            ? `Auto-installed ${skillResult.installed.length} skill(s): ${skillResult.installed.join(", ")}`
            : `Skills detected (${neededSkills.join(", ")}) — all already installed or unavailable`,
          detail: skillResult
        }));
      }
    }
  } catch (err) {
    logger.warn(`Skill auto-install failed (non-blocking): ${err.message}`);
  }

  // --- HU Reviewer auto-activation from triage (post-triage, no huFile needed) ---
  const triageRoles = new Set(triageResult.stageResult?.roles || []);
  if (triageRoles.has("hu-reviewer") && !stageResults.huReviewer) {
    pipelineFlags.huReviewerEnabled = true;
    // Feed PG card structured data to hu-reviewer when available
    let pgStories = null;
    if (pgTaskId && pgProject && session.pg_card) {
      const { buildHuStoriesFromPgCard } = await import("./planning-game/pipeline-adapter.js");
      pgStories = buildHuStoriesFromPgCard(session.pg_card);
    }
    const huResult = await runHuReviewerStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, huFile: null, askQuestion, pgStories });
    stageResults.huReviewer = huResult.stageResult;
  }

  // --- Auto-simplify pipeline for simple tasks (before explicit flag overrides) ---
  const simplified = applyAutoSimplify({
    pipelineFlags,
    triageLevel: triageResult.stageResult?.level || null,
    config, flags, logger, emitter, eventBase
  });
  if (simplified) stageResults.triage.autoSimplified = true;

  const { handlePgDecomposition } = await import("./planning-game/pipeline-adapter.js");
  await handlePgDecomposition({ triageResult, pgTaskId, pgProject, config, askQuestion, emitter, eventBase, session, stageResults, logger });

  applyFlagOverrides(pipelineFlags, flags);

  // --- Auto-detect TDD applicability when methodology not explicitly set ---
  if (!flags.methodology) {
    const projectDir = config.projectDir || process.cwd();
    const detection = await detectTestFramework(projectDir);
    if (!detection.hasTests) {
      config = { ...config, development: { ...config.development, methodology: "standard", require_test_changes: false } };
      logger.info("No test framework detected — using standard methodology");
    } else {
      config = { ...config, development: { ...config.development, methodology: "tdd", require_test_changes: true } };
      logger.info(`Test framework detected (${detection.framework}) — using TDD methodology`);
    }
    emitProgress(emitter, makeEvent("tdd:auto-detect", { ...eventBase, stage: "pre-loop" }, {
      message: detection.hasTests
        ? `TDD auto-detected: ${detection.framework}`
        : "TDD skipped: no test framework found",
      detail: detection
    }));
  }

  let updatedConfig = resolvePipelinePolicies({ flags, config, stageResults, emitter, eventBase, session, pipelineFlags });

  // --- Preflight environment checks ---
  const preflightResult = await runPreflightChecks({
    config: updatedConfig, logger, emitter, eventBase,
    resolvedPolicies: session.resolved_policies,
    securityEnabled: pipelineFlags.securityEnabled
  });
  session.preflight = preflightResult;
  await saveSession(session);

  // Hard fail if blocking checks failed (SonarQube enabled but not available)
  if (!preflightResult.ok) {
    const errorLines = (preflightResult.errors || [])
      .map(e => `  - ${e.message}\n    Fix: ${e.fix}`)
      .join("\n");
    throw new Error(
      `Preflight FAILED — environment changed during session. Fix the issues and retry:\n${errorLines}`
    );
  }

  if (preflightResult.configOverrides.securityDisabled) {
    pipelineFlags.securityEnabled = false;
  }

  // --- Researcher → Planner ---
  const { plannedTask } = await runPlanningPhases({ config: updatedConfig, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion });

  return { plannedTask, updatedConfig };
}

async function runCoderAndRefactorerStages({ coderRoleInstance, coderRole, refactorerRole, pipelineFlags, config, logger, emitter, eventBase, session, plannedTask, trackBudget, i }) {
  const coderResult = await runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
  if (coderResult?.action === "pause") return { action: "return", result: coderResult.result };
  const coderStandby = await handleStandbyResult({ stageResult: coderResult, session, emitter, eventBase, i, stage: "coder", logger });
  if (coderStandby.handled) {
    return coderStandby.action === "return"
      ? { action: "return", result: coderStandby.result }
      : { action: "retry" };
  }

  if (pipelineFlags.refactorerEnabled) {
    const refResult = await runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
    if (refResult?.action === "pause") return { action: "return", result: refResult.result };
    const refStandby = await handleStandbyResult({ stageResult: refResult, session, emitter, eventBase, i, stage: "refactorer", logger });
    if (refStandby.handled) {
      return refStandby.action === "return"
        ? { action: "return", result: refStandby.result }
        : { action: "retry" };
    }
  }

  return { action: "ok" };
}

async function runGuardStages({ config, logger, emitter, eventBase, session, iteration }) {
  const outputEnabled = config.guards?.output?.enabled !== false;
  const perfEnabled = config.guards?.perf?.enabled !== false;

  if (!outputEnabled && !perfEnabled) return { action: "ok" };

  const baseBranch = config.base_branch || "main";
  let diff;
  try {
    const { generateDiff: genDiff, computeBaseRef: compBase } = await import("./review/diff-generator.js");
    const baseRef = await compBase({ baseBranch });
    diff = await genDiff({ baseRef });
  } catch {
    logger.warn("Guards: could not generate diff, skipping");
    return { action: "ok" };
  }

  if (!diff) return { action: "ok" };

  if (outputEnabled) {
    const outputResult = scanDiff(diff, config);
    if (outputResult.violations.length > 0) {
      const critical = outputResult.violations.filter(v => v.severity === "critical");
      const warnings = outputResult.violations.filter(v => v.severity === "warning");
      emitProgress(emitter, makeEvent("guard:output", { ...eventBase, stage: "guard" }, {
        message: `Output guard: ${critical.length} critical, ${warnings.length} warnings`,
        detail: { violations: outputResult.violations, executorType: "local" }
      }));
      logger.info(`Output guard: ${outputResult.violations.length} violation(s) found`);
      for (const v of outputResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-output", iteration, pass: outputResult.pass, violations: outputResult.violations.length });

      if (!outputResult.pass && config.guards.output.on_violation === "block") {
        await markSessionStatus(session, "failed");
        emitProgress(emitter, makeEvent("guard:blocked", { ...eventBase, stage: "guard" }, {
          message: "Output guard blocked: critical violations detected",
          detail: { violations: critical }
        }));
        return {
          action: "return",
          result: { approved: false, sessionId: session.id, reason: "guard_blocked", violations: critical }
        };
      }
    }
  }

  if (perfEnabled) {
    const perfResult = scanPerfDiff(diff, config);
    if (!perfResult.skipped && perfResult.violations.length > 0) {
      emitProgress(emitter, makeEvent("guard:perf", { ...eventBase, stage: "guard" }, {
        message: `Perf guard: ${perfResult.violations.length} issue(s)`,
        detail: { violations: perfResult.violations, executorType: "local" }
      }));
      logger.info(`Perf guard: ${perfResult.violations.length} issue(s) found`);
      for (const v of perfResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-perf", iteration, pass: perfResult.pass, violations: perfResult.violations.length });
    }
  }

  return { action: "ok" };
}

async function runQualityGateStages({ config, logger, emitter, eventBase, session, trackBudget, i, askQuestion, repeatDetector, budgetSummary, sonarState, task, stageResults, coderRole, pipelineFlags }) {
  const tddResult = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: i, askQuestion });
  if (tddResult.action === "pause") return { action: "return", result: tddResult.result };
  if (tddResult.action === "continue") return { action: "continue" };

  const skipSonarForTaskType = new Set(["infra", "doc", "no-code"]);
  const effectiveTaskType = session.resolved_policies?.taskType || null;
  if (config.sonarqube.enabled && !skipSonarForTaskType.has(effectiveTaskType)) {
    const sonarResult = await runSonarStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i,
      repeatDetector, budgetSummary, sonarState, askQuestion, task
    });
    if (sonarResult.action === "stalled" || sonarResult.action === "pause") return { action: "return", result: sonarResult.result };
    if (sonarResult.action === "continue") return { action: "continue" };
    if (sonarResult.stageResult) {
      stageResults.sonar = sonarResult.stageResult;
      await tryBecariaComment({ config, session, logger, agent: "Sonar", body: `SonarQube scan: ${sonarResult.stageResult.summary || "completed"}` });
    }
  }

  if (config.sonarcloud?.enabled) {
    const cloudResult = await runSonarCloudStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i
    });
    if (cloudResult.stageResult) {
      stageResults.sonarcloud = cloudResult.stageResult;
    }
  }

  if (pipelineFlags?.impeccableEnabled) {
    const diff = await generateDiff({ baseRef: session.session_start_sha });
    const impeccableResult = await runImpeccableStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff
    });
    if (impeccableResult.stageResult) {
      stageResults.impeccable = impeccableResult.stageResult;
    }
  }

  return { action: "ok" };
}

async function runReviewerGateStage({ pipelineFlags, reviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion }) {
  if (!pipelineFlags.reviewerEnabled) {
    return {
      action: "ok",
      review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Reviewer disabled by pipeline", confidence: 1 }
    };
  }

  const reviewerResult = await runReviewerStage({
    reviewerRole, config, logger, emitter, eventBase, session, trackBudget,
    iteration: i, reviewRules, task, repeatDetector, budgetSummary, askQuestion
  });
  if (reviewerResult.action === "pause") return { action: "return", result: reviewerResult.result };
  const revStandby = await handleStandbyResult({ stageResult: reviewerResult, session, emitter, eventBase, i, stage: "reviewer", logger });
  if (revStandby.handled) {
    return revStandby.action === "return"
      ? { action: "return", result: revStandby.result }
      : { action: "retry" };
  }
  if (reviewerResult.stalled) return { action: "return", result: reviewerResult.stalledResult };
  return { action: "ok", review: reviewerResult.review };
}

async function handleApprovedReview({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, pipelineFlags, askQuestion, logger, gitCtx, budgetSummary, pgCard, pgProject, review, rtkTracker }) {
  session.reviewer_retry_count = 0;
  const postLoopResult = await handlePostLoopStages({
    config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults,
    becariaEnabled: Boolean(config.becaria?.enabled), testerEnabled: pipelineFlags.testerEnabled, securityEnabled: pipelineFlags.securityEnabled, askQuestion, logger
  });
  if (postLoopResult.action === "return") return { action: "return", result: postLoopResult.result };
  if (postLoopResult.action === "continue") return { action: "continue" };

  const result = await finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker });
  return { action: "return", result };
}

async function handleMaxIterationsReached({ session, budgetSummary, emitter, eventBase, config, stageResults, logger, askQuestion, task, rtkTracker }) {
  // Escalate to Solomon / human before giving up
  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "max_iterations", askQuestion, session,
    iteration: config.max_iterations,
    conflict: {
      stage: "max_iterations",
      task,
      iterationCount: config.max_iterations,
      maxIterations: config.max_iterations,
      history: [{ agent: "pipeline", feedback: session.last_reviewer_feedback || "Max iterations reached without reviewer approval" }]
    }
  });

  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      session.last_reviewer_feedback = `User guidance: ${solomonResult.humanGuidance}`;
    }
    session.reviewer_retry_count = 0;
    await saveSession(session);
    return { approved: false, sessionId: session.id, reason: "max_iterations_extended", humanGuidance: solomonResult.humanGuidance };
  }

  if (solomonResult.action === "pause") {
    return { paused: true, sessionId: session.id, question: solomonResult.question, context: "max_iterations" };
  }

  if (solomonResult.action === "subtask") {
    return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "max_iterations_subtask" };
  }

  // Solomon also couldn't resolve — fail
  session.budget = budgetSummary();
  const rtkSavings = rtkTracker?.hasData() ? rtkTracker.summary() : undefined;
  if (rtkSavings) session.rtk_savings = rtkSavings;
  await markSessionStatus(session, "failed");
  const failDetail = { approved: false, reason: "max_iterations", iterations: config.max_iterations, stages: stageResults, budget: budgetSummary() };
  if (rtkSavings) failDetail.rtk_savings = rtkSavings;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      status: "fail",
      message: "Max iterations reached (Solomon could not resolve)",
      detail: failDetail
    })
  );
  return { approved: false, sessionId: session.id, reason: "max_iterations" };
}

async function tryAutoStartBoard(config, logger, emitter, eventBase) {
  if (!config.hu_board?.enabled || !config.hu_board?.auto_start) return;

  try {
    const { startBoard } = await import("./commands/board.js");
    const boardPort = config.hu_board.port || 4000;
    const boardResult = await startBoard(boardPort);
    const status = boardResult.alreadyRunning ? "already running" : "started";
    logger.info(`HU Board ${status} at ${boardResult.url}`);
    emitProgress(emitter, makeEvent("board:started", eventBase, {
      message: `HU Board running at ${boardResult.url}`,
      detail: { pid: boardResult.pid, port: boardPort }
    }));
  } catch (err) {
    logger.warn(`HU Board auto-start failed (non-blocking): ${err.message}`);
  }
}

async function initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags }) {
  const ctx = new PipelineContext({ config, session: null, logger, emitter, task, flags });
  ctx.askQuestion = askQuestion;
  ctx.pgTaskId = pgTaskId;
  ctx.pgProject = pgProject;

  ctx.coderRole = resolveRole(config, "coder");
  ctx.reviewerRole = resolveRole(config, "reviewer");
  ctx.refactorerRole = resolveRole(config, "refactorer");
  ctx.pipelineFlags = resolvePipelineFlags(config);
  ctx.repeatDetector = new RepeatDetector({ threshold: getRepeatThreshold(config) });
  ctx.coderRoleInstance = new CoderRole({ config, logger, emitter, createAgentFn: createAgent, askHost: askQuestion });
  ctx.startedAt = Date.now();
  ctx.eventBase = { sessionId: null, iteration: 0, stage: null, startedAt: ctx.startedAt };
  const { budgetTracker, budgetLimit, budgetSummary, trackBudget } = createBudgetManager({ config, emitter, eventBase: ctx.eventBase });
  ctx.budgetTracker = budgetTracker;
  ctx.budgetLimit = budgetLimit;
  ctx.budgetSummary = budgetSummary;
  ctx.trackBudget = trackBudget;

  // --- RTK detection ---
  const rtkResult = await detectRtk();
  if (rtkResult.available) {
    config = { ...config, rtk: { available: true, version: rtkResult.version } };
    const rtkTracker = new RtkSavingsTracker();
    const rtkRunner = createRtkRunner(true, rtkTracker);
    setDiffRunner(rtkRunner);
    setGitRunner(rtkRunner);
    ctx.rtkTracker = rtkTracker;
    logger.info(`RTK detected (${rtkResult.version}) — wrapping internal git/diff commands with rtk`);
    emitProgress(emitter, makeEvent("rtk:detected", ctx.eventBase, {
      message: "RTK detected — internal commands wrapped for token optimization",
      detail: { version: rtkResult.version, executorType: "local" }
    }));
  }

  // --- HU Board auto-start ---
  await tryAutoStartBoard(config, logger, emitter, ctx.eventBase);

  // --- Product Context ---
  const ctxProjectDir = config.projectDir || process.cwd();
  const { content: productContext, source: productContextSource } = await loadProductContext(ctxProjectDir);
  if (productContext) {
    config = { ...config, productContext };
    logger.info(`Product context loaded from ${productContextSource}`);
    emitProgress(emitter, makeEvent("context:loaded", ctx.eventBase, {
      message: "Product context loaded",
      detail: { source: productContextSource }
    }));
  }

  ctx.session = await initializeSession({ task, config, flags, pgTaskId, pgProject });
  ctx.eventBase.sessionId = ctx.session.id;

  const { initPgAdapter } = await import("./planning-game/pipeline-adapter.js");
  const pgAdapterResult = await initPgAdapter({ session: ctx.session, config, logger, pgTaskId, pgProject });
  ctx.pgCard = pgAdapterResult.pgCard;
  ctx.session.pg_card = ctx.pgCard || null;

  emitProgress(
    emitter,
    makeEvent("session:start", ctx.eventBase, {
      message: "Session started",
      detail: { task, coder: ctx.coderRole.provider, reviewer: ctx.reviewerRole.provider, maxIterations: config.max_iterations }
    })
  );

  ctx.stageResults = {};
  ctx.sonarState = { issuesInitial: null, issuesFinal: null };

  const preLoopResult = await runPreLoopStages({ config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session, flags, pipelineFlags: ctx.pipelineFlags, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults: ctx.stageResults });
  ctx.plannedTask = preLoopResult.plannedTask;
  ctx.config = preLoopResult.updatedConfig;

  ctx.gitCtx = await prepareGitAutomation({ config: ctx.config, task, logger, session: ctx.session });
  const projectDir = ctx.config.projectDir || process.cwd();
  ctx.reviewRules = (await resolveReviewProfile({ mode: ctx.config.review_mode, projectDir })).rules;
  await ctx.coderRoleInstance.init();

  return ctx;
}

async function runSingleIteration(ctx) {
  const { config, logger, emitter, eventBase, session, task, iteration: i } = ctx;

  const iterStart = Date.now();
  const becariaEnabled = Boolean(config.becaria?.enabled) && ctx.gitCtx?.enabled;
  logger.setContext({ iteration: i, stage: "iteration" });

  const reviewerRetryCount = session.reviewer_retry_count || 0;
  const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
  const iterLang = getLang(config);
  const iterMsg = msg("pipeline_iteration", iterLang, { current: i, max: config.max_iterations });
  emitProgress(emitter, makeEvent("iteration:start", { ...eventBase, stage: "iteration" }, {
    message: iterMsg,
    detail: { iteration: i, maxIterations: config.max_iterations, reviewerRetryCount, maxReviewerRetries }
  }));
  logger.info(iterMsg);

  const crResult = await runCoderAndRefactorerStages({
    coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole, refactorerRole: ctx.refactorerRole,
    pipelineFlags: ctx.pipelineFlags, config, logger, emitter, eventBase, session,
    plannedTask: ctx.plannedTask, trackBudget: ctx.trackBudget, i
  });
  if (crResult.action === "return" || crResult.action === "retry") return crResult;

  const guardResult = await runGuardStages({ config, logger, emitter, eventBase, session, iteration: i });
  if (guardResult.action === "return") return guardResult;

  const qgResult = await runQualityGateStages({
    config, logger, emitter, eventBase, session, trackBudget: ctx.trackBudget, i,
    askQuestion: ctx.askQuestion, repeatDetector: ctx.repeatDetector, budgetSummary: ctx.budgetSummary,
    sonarState: ctx.sonarState, task, stageResults: ctx.stageResults, coderRole: ctx.coderRole,
    pipelineFlags: ctx.pipelineFlags
  });
  if (qgResult.action === "return" || qgResult.action === "continue") return qgResult;

  await handleBecariaEarlyPrOrPush({
    becariaEnabled, config, session, emitter, eventBase, gitCtx: ctx.gitCtx, task, logger,
    stageResults: ctx.stageResults, i
  });

  const revResult = await runReviewerGateStage({
    pipelineFlags: ctx.pipelineFlags, reviewerRole: ctx.reviewerRole, config, logger, emitter, eventBase,
    session, trackBudget: ctx.trackBudget, i, reviewRules: ctx.reviewRules, task,
    repeatDetector: ctx.repeatDetector, budgetSummary: ctx.budgetSummary, askQuestion: ctx.askQuestion
  });
  if (revResult.action === "return" || revResult.action === "retry") return revResult;
  const review = revResult.review;

  const iterDuration = Date.now() - iterStart;
  emitProgress(emitter, makeEvent("iteration:end", { ...eventBase, stage: "iteration" }, {
    message: `Iteration ${i} completed`, detail: { duration: iterDuration }
  }));
  session.standby_retry_count = 0;

  const solomonResult = await handleSolomonCheck({
    config, session, emitter, eventBase, logger, task, i, askQuestion: ctx.askQuestion,
    becariaEnabled, blockingIssues: review?.blocking_issues
  });
  if (solomonResult.action === "pause") return { action: "return", result: solomonResult.result };

  await handleBecariaReviewDispatch({ becariaEnabled, config, session, review, i, logger });

  if (review.approved) {
    const approvedResult = await handleApprovedReview({
      config, session, emitter, eventBase, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, i, task,
      stageResults: ctx.stageResults, pipelineFlags: ctx.pipelineFlags, askQuestion: ctx.askQuestion, logger,
      gitCtx: ctx.gitCtx, budgetSummary: ctx.budgetSummary, pgCard: ctx.pgCard, pgProject: ctx.pgProject, review,
      rtkTracker: ctx.rtkTracker
    });
    if (approvedResult.action === "return" || approvedResult.action === "continue") return approvedResult;
  }

  // Solomon already evaluated the rejection in runReviewerStage -> handleReviewerRejection
  // Only use retry counter as fallback if Solomon is disabled
  if (!config.pipeline?.solomon?.enabled) {
    const retryResult = await handleReviewerRetryAndSolomon({ config, session, emitter, eventBase, logger, review, task, i, askQuestion: ctx.askQuestion });
    if (retryResult.action === "return") return retryResult;
  } else {
    // Solomon is enabled — feed back the blocking issues for the next coder iteration
    session.last_reviewer_feedback = review.blocking_issues
      .map((x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`)
      .join("\n");
    await saveSession(session);
  }

  return { action: "next" };
}

async function writeHistoryRecord({ sessionId, task, result, logger }) {
  try {
    const { createHistoryRecord } = await import("./hu/store.js");
    const approved = Boolean(result?.approved);
    const summary = result?.review?.summary || result?.reason || null;
    await createHistoryRecord(sessionId, {
      task,
      result: JSON.stringify(result),
      approved,
      summary
    });
  } catch (err) {
    logger.warn(`HU history record failed (non-blocking): ${err.message}`);
  }
}

/**
 * Run the standard iteration loop for a given task using the pipeline context.
 * Returns a result object with at least { approved: boolean }.
 * Used both as the main loop and as the per-HU callback in sub-pipeline mode.
 */
async function runIterationLoop(ctx, { task: loopTask, askQuestion, emitter, logger }) {
  ctx.plannedTask = loopTask;

  const checkpointIntervalMs = (ctx.config.session.checkpoint_interval_minutes ?? 5) * 60 * 1000;
  let lastCheckpointAt = Date.now();
  let checkpointDisabled = false;
  let lastCheckpointSnapshot = takeCheckpointSnapshot(ctx.session);

  let i = 0;
  while (i < ctx.config.max_iterations) {
    i += 1;
    const elapsedMinutes = (Date.now() - ctx.startedAt) / 60000;

    const cpResult = await handleCheckpoint({
      checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes,
      i, config: ctx.config, budgetTracker: ctx.budgetTracker, stageResults: ctx.stageResults, emitter, eventBase: ctx.eventBase, session: ctx.session, budgetSummary: ctx.budgetSummary, lastCheckpointSnapshot
    });
    if (cpResult.action === "stop") {
      return cpResult.result;
    }
    checkpointDisabled = cpResult.checkpointDisabled;
    lastCheckpointAt = cpResult.lastCheckpointAt;
    if (cpResult.lastCheckpointSnapshot !== undefined) lastCheckpointSnapshot = cpResult.lastCheckpointSnapshot;

    await checkSessionTimeout({ askQuestion, elapsedMinutes, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetSummary: ctx.budgetSummary });
    await checkBudgetExceeded({ budgetTracker: ctx.budgetTracker, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetLimit: ctx.budgetLimit, budgetSummary: ctx.budgetSummary });

    ctx.eventBase.iteration = i;
    ctx.iteration = i;

    const iterResult = await runSingleIteration(ctx);
    if (iterResult.action === "return") {
      return iterResult.result;
    }
    if (iterResult.action === "retry") { i -= 1; }
  }

  const maxIterResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker });
  return maxIterResult;
}

export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null, pgTaskId = null, pgProject = null }) {
  const pipelineFlags = resolvePipelineFlags(config);

  if (flags.dryRun) {
    return handleDryRun({ task, config, flags, emitter, pipelineFlags });
  }

  const ctx = await initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags });

  try {
    // --- Analysis-only flow: skip coder/reviewer when coderRequired === false ---
    if (ctx.pipelineFlags.coderRequired === false) {
      logger.info("Analysis-only task — skipping coder/reviewer iteration loop");
      emitProgress(emitter, makeEvent("pipeline:analysis-only", { ...ctx.eventBase, stage: "analysis" }, {
        message: "Analysis-only task — running security and audit stages only",
        detail: { taskType: ctx.session.resolved_policies?.taskType, coderRequired: false }
      }));

      const analysisStageResults = ctx.stageResults;
      const postLoopDiff = await generateDiff({ baseRef: ctx.session.session_start_sha });

      if (ctx.pipelineFlags.securityEnabled) {
        const securityResult = await runSecurityStage({
          config: ctx.config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session,
          coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
          iteration: 1, task: ctx.plannedTask, diff: postLoopDiff, askQuestion
        });
        if (securityResult.stageResult) analysisStageResults.security = securityResult.stageResult;
      }

      const auditResult = await runFinalAuditStage({
        config: ctx.config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session,
        coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
        iteration: 1, task: ctx.plannedTask, diff: postLoopDiff
      });
      if (auditResult.stageResult) analysisStageResults.audit = auditResult.stageResult;

      ctx.session.budget = ctx.budgetSummary();
      await markSessionStatus(ctx.session, "approved");

      const analysisResult = {
        approved: true,
        sessionId: ctx.session.id,
        analysisOnly: true,
        stages: analysisStageResults,
        budget: ctx.budgetSummary()
      };
      await writeHistoryRecord({ sessionId: ctx.session.id, task, result: analysisResult, logger });

      emitProgress(emitter, makeEvent("session:end", { ...ctx.eventBase, stage: "done" }, {
        message: "Analysis-only session completed",
        detail: analysisResult
      }));

      return analysisResult;
    }

    // --- HU Sub-Pipeline: run each certified HU as an independent iteration loop ---
    if (needsSubPipeline(ctx.stageResults.huReviewer)) {
      logger.info(`HU sub-pipeline: ${ctx.stageResults.huReviewer.certified} certified stories — running each as a sub-pipeline`);
      emitProgress(emitter, makeEvent("hu:sub-pipeline:start", { ...ctx.eventBase, stage: "hu-sub-pipeline" }, {
        message: `Running ${ctx.stageResults.huReviewer.certified} HUs as sub-pipelines`,
        detail: { total: ctx.stageResults.huReviewer.total, certified: ctx.stageResults.huReviewer.certified }
      }));

      const subPipelineResult = await runHuSubPipeline({
        huReviewerResult: ctx.stageResults.huReviewer,
        runIterationFn: async (huTask) => runIterationLoop(ctx, { task: huTask, askQuestion, emitter, logger }),
        emitter,
        eventBase: ctx.eventBase,
        logger,
        config: ctx.config
      });

      emitProgress(emitter, makeEvent("hu:sub-pipeline:end", { ...ctx.eventBase, stage: "hu-sub-pipeline" }, {
        status: subPipelineResult.approved ? "ok" : "fail",
        message: subPipelineResult.approved
          ? "All HUs completed successfully"
          : `Sub-pipeline finished with failures (${subPipelineResult.blockedIds.length} blocked)`,
        detail: { results: subPipelineResult.results, blockedIds: subPipelineResult.blockedIds }
      }));

      const finalResult = {
        approved: subPipelineResult.approved,
        sessionId: ctx.session.id,
        huResults: subPipelineResult.results,
        blockedIds: subPipelineResult.blockedIds
      };
      await writeHistoryRecord({ sessionId: ctx.session.id, task, result: finalResult, logger });
      return finalResult;
    }

    // --- Standard single-task pipeline (1 HU or no HU reviewer) ---
    const result = await runIterationLoop(ctx, { task: ctx.plannedTask, askQuestion, emitter, logger });
    await writeHistoryRecord({ sessionId: ctx.session.id, task, result, logger });
    return result;
  } finally {
    // --- Cleanup auto-installed skills ---
    const autoSkills = ctx.session?.autoInstalledSkills;
    if (autoSkills && autoSkills.length > 0) {
      const cleanProjectDir = ctx.config?.projectDir || process.cwd();
      try {
        const cleanupResult = await cleanupAutoInstalledSkills(autoSkills, cleanProjectDir);
        if (cleanupResult.removed.length > 0) {
          logger.info(`Cleaned up ${cleanupResult.removed.length} auto-installed skill(s): ${cleanupResult.removed.join(", ")}`);
        }
      } catch (err) {
        logger.warn(`Skill cleanup failed (non-blocking): ${err.message}`);
      }
    }
  }
}

export async function resumeFlow({ sessionId, answer, config, logger, flags = {}, emitter = null, askQuestion = null }) {
  const session = answer
    ? await resumeSessionWithAnswer(sessionId, answer)
    : await loadSession(sessionId);

  if (session.status === "paused" && !answer) {
    logger.info(`Session ${sessionId} is paused. Provide --answer to resume.`);
    return session;
  }

  // Allow resuming "stopped" sessions (checkpoint stop) and "failed" sessions
  const resumableStatuses = new Set(["running", "stopped", "failed"]);
  if (!resumableStatuses.has(session.status)) {
    logger.info(`Session ${sessionId} has status ${session.status} — not resumable`);
    return session;
  }

  // Mark as running again for stopped/failed sessions
  if (session.status !== "running") {
    logger.info(`Resuming ${session.status} session ${sessionId}`);
    session.status = "running";
    await saveSession(session);
  }

  // Session was paused and now resumed with answer - re-run the flow
  const task = session.task;
  const sessionConfig = config || session.config_snapshot;
  if (!sessionConfig) {
    throw new Error("No config available to resume session");
  }

  logger.info(`Resuming session ${sessionId} with answer: ${answer}`);

  // Inject the answer as additional feedback for the coder
  if (session.paused_state?.context?.lastFeedback) {
    session.last_reviewer_feedback = `Previous feedback: ${session.paused_state.context.lastFeedback}\nUser guidance: ${answer}`;
  }
  session.repeated_issue_count = 0;
  session.sonar_retry_count = 0;
  session.reviewer_retry_count = 0;
  session.standby_retry_count = 0;
  session.tester_retry_count = 0;
  session.security_retry_count = 0;
  session.last_sonar_issue_signature = null;
  session.sonar_repeat_count = 0;
  session.last_reviewer_issue_signature = null;
  session.reviewer_repeat_count = 0;
  await saveSession(session);

  // Re-run the flow with the existing session context
  try {
    return await runFlow({ task, config: sessionConfig, logger, flags, emitter, askQuestion });
  } catch (err) {
    await markSessionStatus(session, "failed");
    throw err;
  }
}
