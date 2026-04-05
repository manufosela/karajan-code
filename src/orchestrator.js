import { createAgent } from "./agents/index.js";
import {
  loadSession,
  markSessionStatus,
  pauseSession,
  resumeSessionWithAnswer,
  saveSession,
  addCheckpoint
} from "./session-store.js";
import { generateDiff } from "./review/diff-generator.js";
import { resolveRole } from "./config.js";
import { resolveReviewProfile } from "./review/profiles.js";
import { msg, getLang } from "./utils/messages.js";
import { RepeatDetector, getRepeatThreshold } from "./repeat-detector.js";
import { emitProgress, makeEvent } from "./utils/events.js";
import {
  prepareGitAutomation,
  finalizeGitAutomation
} from "./git/automation.js";
import { scanDiff } from "./guards/output-guard.js";
import { scanPerfDiff } from "./guards/perf-guard.js";
import { classifyIntent } from "./guards/intent-guard.js";
import { CoderRole } from "./roles/coder-role.js";
import { invokeSolomon } from "./orchestrator/solomon-escalation.js";
import { PipelineContext } from "./orchestrator/pipeline-context.js";
import { runTriageStage, runResearcherStage, runArchitectStage, runPlannerStage, runDiscoverStage, runHuReviewerStage } from "./orchestrator/pre-loop-stages.js";
import { runDomainCuratorStage } from "./orchestrator/stages/domain-curator-stage.js";
import { persistInlineDomain } from "./domains/domain-loader.js";
import { runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runSonarCloudStage, runReviewerStage } from "./orchestrator/iteration-stages.js";
import { runTesterStage, runSecurityStage, runImpeccableStage, runFinalAuditStage } from "./orchestrator/post-loop-stages.js";
import { needsSubPipeline, runHuSubPipeline } from "./orchestrator/hu-sub-pipeline.js";
import { waitForCooldown, MAX_STANDBY_RETRIES } from "./orchestrator/standby.js";
import { detectTestFramework } from "./utils/project-detect.js";
import { runPreflightChecks } from "./orchestrator/preflight-checks.js";
import { detectRtk } from "./utils/rtk-detect.js";
import { createRtkRunner, RtkSavingsTracker } from "./utils/rtk-wrapper.js";
import { setRunner as setDiffRunner, setProjectDir as setDiffProjectDir } from "./review/diff-generator.js";
import { setRunner as setGitRunner } from "./utils/git.js";
import { detectNeededSkills, autoInstallSkills, cleanupAutoInstalledSkills } from "./skills/skill-detector.js";
import { isOpenSkillsAvailable } from "./skills/openskills-client.js";

// Extracted modules
import {
  loadProductContext as _loadProductContext,
  resolvePipelineFlags, handleDryRun, createBudgetManager,
  initializeSession, applyTriageOverrides, applyAutoSimplify,
  applyFlagOverrides, resolvePipelinePolicies, autoInit,
  updateGitignoreForStack
} from "./orchestrator/config-init.js";
import {
  tryCiComment, handleCiEarlyPrOrPush, handleCiReviewDispatch,
  formatBlockingIssues
} from "./orchestrator/ci-integration.js";
import {
  shouldAutoContinueCheckpoint as _shouldAutoContinueCheckpoint,
  parseCheckpointAnswer as _parseCheckpointAnswer,
  handleCheckpoint, checkSessionTimeout, checkBudgetExceeded,
  takeCheckpointSnapshot
} from "./orchestrator/flow-control.js";
import {
  createJournalDir, writePreLoopJournal, writeIterationsJournal,
  writeDecisionsJournal, writeTreeJournal, writeSummaryJournal,
  formatIteration, formatDecision, buildPlanSummary
} from "./orchestrator/session-journal.js";

// Re-export for external consumers
export const loadProductContext = _loadProductContext;
export const shouldAutoContinueCheckpoint = _shouldAutoContinueCheckpoint;
export const parseCheckpointAnswer = _parseCheckpointAnswer;


// PG card "In Progress" logic moved to src/planning-game/pipeline-adapter.js → initPgAdapter()

async function runPlanningPhases({ config, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx }) {
  let researchContext = null;
  let plannedTask = task;

  // Brain: track compression across pre-loop roles
  const brainCompress = brainCtx?.enabled
    ? (await import("./orchestrator/brain-coordinator.js")).processRoleOutput
    : null;

  if (pipelineFlags.researcherEnabled) {
    const researcherResult = await runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    researchContext = researcherResult.researchContext;
    stageResults.researcher = researcherResult.stageResult;
    if (brainCompress) brainCompress(brainCtx, { roleName: "researcher", output: researcherResult.stageResult, iteration: 0 });
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
    if (brainCompress) brainCompress(brainCtx, { roleName: "architect", output: architectResult.stageResult, iteration: 0 });
  }

  const triageDecomposition = stageResults.triage?.shouldDecompose ? stageResults.triage.subtasks : null;
  if (pipelineFlags.plannerEnabled) {
    const plannerRole = resolveRole(config, "planner");
    const plannerResult = await runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, architectContext, triageDecomposition, trackBudget });
    plannedTask = plannerResult.plannedTask;
    stageResults.planner = plannerResult.stageResult;
    if (brainCompress) brainCompress(brainCtx, { roleName: "planner", output: plannerResult.stageResult, iteration: 0 });

    await tryCiComment({
      config, session, logger,
      agent: "Planner",
      body: `Plan: ${plannerResult.stageResult?.summary || plannedTask}`
    });
  }

  return { plannedTask };
}



async function handleStandbyResult({ stageResult, session, emitter, eventBase, i, stage, logger, config, askQuestion }) {
  if (stageResult?.action !== "standby") {
    return { handled: false };
  }

  const isOutage = stageResult.standbyInfo.isProviderOutage;
  const agent = stageResult.standbyInfo.agent;
  const cooldownUntil = stageResult.standbyInfo.cooldownUntil;
  const cooldownMs = stageResult.standbyInfo.cooldownMs;

  // Rate limit = out of normal flow → Solomon decides immediately
  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: `${stage}_rate_limit`, askQuestion, session,
    iteration: i,
    conflict: {
      stage: `${stage}_rate_limit`,
      task: session.task,
      iterationCount: i,
      maxIterations: config?.max_iterations || 5,
      cooldownUntil,
      cooldownMs,
      history: [{
        agent: stage,
        feedback: `Agent "${agent}" rate-limited. ${isOutage ? "Provider outage (5xx)." : "API rate limit (429)."} ${cooldownUntil ? `Cooldown until ${cooldownUntil}.` : ""}`
      }]
    }
  });

  if (solomonResult.action === "approve") {
    // Solomon says skip is safe — only allowed after exhausting alternatives
    logger.info(`Solomon: skip ${stage} after evaluating risk (agent "${agent}" rate-limited)`);
    emitProgress(emitter, makeEvent(`${stage}:rate_limit`, { ...eventBase, stage }, {
      status: "ok",
      message: `Solomon: skip ${stage} (low risk, agent "${agent}" unavailable)`,
      detail: { agent, solomonAction: "approve" }
    }));
    return { handled: true, action: "skip" };
  }

  if (solomonResult.action === "continue") {
    // Solomon says: wait for cooldown, or retry with alternative agent
    const altAgent = solomonResult.alternativeAgent;
    const waitTarget = solomonResult.waitUntil;

    if (waitTarget) {
      const waitMs = Math.max(0, new Date(waitTarget).getTime() - Date.now());
      if (waitMs > 0 && waitMs < 10 * 60 * 1000) {
        logger.info(`Solomon: wait ${Math.round(waitMs / 1000)}s for cooldown, then retry ${stage}`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    if (altAgent) {
      logger.info(`Solomon: retry ${stage} with alternative agent "${altAgent}"`);
      session._alternative_agent = { stage, provider: altAgent };
    }

    if (solomonResult.humanGuidance) {
      session.last_reviewer_feedback = `Solomon guidance: ${solomonResult.humanGuidance}`;
    }
    await saveSession(session);
    return { handled: true, action: "retry_reviewer_only" };
  }

  if (solomonResult.action === "pause") {
    return {
      handled: true,
      action: "return",
      result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "rate_limit" }
    };
  }

  // Solomon couldn't resolve — pause
  await pauseSession(session, {
    question: `Agent "${agent}" rate-limited. Solomon could not resolve.`,
    context: { iteration: i, stage, reason: "rate_limit" }
  });
  return {
    handled: true,
    action: "return",
    result: { paused: true, sessionId: session.id, question: `Agent "${agent}" rate-limited`, context: "rate_limit" }
  };
}


function emitSolomonAlerts(alerts, emitter, eventBase, logger) {
  for (const alert of alerts) {
    emitProgress(emitter, makeEvent("brain:rules-alert", { ...eventBase, stage: "brain" }, {
      status: alert.severity === "critical" ? "fail" : "warn",
      message: alert.message,
      detail: alert.detail
    }));
    logger.warn(`Rules alert [${alert.rule}]: ${alert.message}`);
  }
}

async function handleSolomonCheck({ config, session, emitter, eventBase, logger, task, i, askQuestion, ciEnabled, blockingIssues, brainCtx }) {
  if (config.pipeline?.solomon?.enabled === false) return { action: "continue" };

  try {
    const { evaluateRules, buildRulesContext } = await import("./orchestrator/solomon-rules.js");
    const rulesContext = await buildRulesContext({ session, task, iteration: i, blockingIssues });
    const rulesResult = evaluateRules(rulesContext, config.solomon?.rules);

    if (rulesResult.alerts.length > 0) {
      emitSolomonAlerts(rulesResult.alerts, emitter, eventBase, logger);
      // Brain gateway: when Brain is the orchestrator, rule alerts are telemetry.
      // On critical alerts Brain consults Solomon (AI judge). Only if Solomon can't
      // resolve does Brain escalate to human. Solomon-rules never prompts directly.
      if (!brainCtx?.enabled) {
        const pauseResult = await checkSolomonCriticalAlerts({ rulesResult, askQuestion, session, i });
        if (pauseResult) return pauseResult;
      } else if (rulesResult.hasCritical) {
        const criticalAlerts = rulesResult.alerts.filter(a => a.severity === "critical");
        brainCtx.ruleAlerts = brainCtx.ruleAlerts || [];
        brainCtx.ruleAlerts.push(...criticalAlerts);
        logger.info(`Brain: ${criticalAlerts.length} critical rule alert(s) — consulting Solomon`);

        const { invokeSolomon } = await import("./orchestrator/solomon-escalation.js");
        const alertSummary = criticalAlerts.map(a => a.message).join("; ");
        const solomonOpinion = await invokeSolomon({
          config, logger, emitter, eventBase, stage: "brain-dilemma", askQuestion, session, iteration: i,
          conflict: {
            stage: "brain-dilemma",
            task,
            iterationCount: i,
            maxIterations: config.max_iterations,
            dilemma: `Brain detected critical rule alerts: ${alertSummary}. Should we continue iterating, pause for human, or stop?`,
            ruleAlerts: criticalAlerts,
            blockingIssues: blockingIssues || [],
            history: (session.checkpoints || []).filter(cp => cp.stage === "reviewer").slice(-5).map(cp => ({ iteration: cp.iteration, feedback: cp.note || "" }))
          }
        });

        if (solomonOpinion.action === "pause") {
          logger.info("Brain: Solomon advised pause — escalating to human");
          return { action: "return", result: { paused: true, sessionId: session.id, question: solomonOpinion.question || `Brain+Solomon paused: ${alertSummary}`, context: "brain_solomon_dilemma" } };
        }
        if (solomonOpinion.action === "approve") {
          logger.info("Brain: Solomon advised proceeding — treating as approved");
          return { action: "continue", approved: true };
        }
        // action === "continue" | "subtask" | fallback → Brain continues the loop
        logger.info(`Brain: Solomon said '${solomonOpinion.action}' — continuing loop`);
      }
    }

    if (ciEnabled && session.ci_pr_number) {
      const alerts = rulesResult.alerts || [];
      const alertMsg = alerts.length > 0
        ? alerts.map(a => `- [${a.severity}] ${a.message}`).join("\n")
        : "No anomalies detected";
      await tryCiComment({
        config, session, logger,
        agent: "Solomon",
        body: `Supervisor check iteration ${i}: ${alertMsg}`
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


async function handlePostLoopStages({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, ciEnabled, testerEnabled, securityEnabled, askQuestion, logger, brainCtx }) {
  const postLoopDiff = await generateDiff({ baseRef: session.session_start_sha });

  if (testerEnabled) {
    const testerResult = await runTesterStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion
    });
    if (testerResult.action === "pause") return { action: "return", result: testerResult.result };
    if (testerResult.action === "continue") {
      const summary = testerResult.stageResult?.summary || "Tester found issues";
      session.last_reviewer_feedback = `Tester FAILED — fix these issues:\n${summary}`;
      await saveSession(session);
      if (testerResult.stageResult) stageResults.tester = testerResult.stageResult;
      // Brain: push tester failure into feedback queue + compress for next coder iteration
      if (brainCtx?.enabled) {
        const { processRoleOutput } = await import("./orchestrator/brain-coordinator.js");
        processRoleOutput(brainCtx, { roleName: "tester", output: testerResult.stageResult, iteration: i });
      }
      return { action: "continue" };
    }
    if (testerResult.stageResult) {
      stageResults.tester = testerResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Tester", body: `Tests: ${testerResult.stageResult.summary || "completed"}` });
    }
  }

  if (securityEnabled) {
    const securityResult = await runSecurityStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion
    });
    if (securityResult.action === "pause") return { action: "return", result: securityResult.result };
    if (securityResult.action === "continue") {
      const summary = securityResult.stageResult?.summary || "Security found issues";
      session.last_reviewer_feedback = `Security FAILED — fix these issues:\n${summary}`;
      await saveSession(session);
      if (securityResult.stageResult) stageResults.security = securityResult.stageResult;
      // Brain: push security findings into feedback queue + compress for next coder iteration
      if (brainCtx?.enabled) {
        const { processRoleOutput } = await import("./orchestrator/brain-coordinator.js");
        processRoleOutput(brainCtx, { roleName: "security", output: securityResult.stageResult, iteration: i });
      }
      return { action: "continue" };
    }
    if (securityResult.stageResult) {
      stageResults.security = securityResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Security", body: `Security scan: ${securityResult.stageResult.summary || "completed"}` });
    }
  }

  // Final audit — last quality gate before declaring success
  const auditResult = await runFinalAuditStage({
    config, logger, emitter, eventBase, session, coderRole, trackBudget,
    iteration: i, task, diff: postLoopDiff
  });
  if (auditResult.stageResult) {
    stageResults.audit = auditResult.stageResult;
    await tryCiComment({ config, session, logger, agent: "Audit", body: `Final audit: ${auditResult.stageResult.summary || "completed"}` });
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

  // --- Journal: write final files ---
  const journalDir = session._journalDir;
  if (journalDir) {
    try {
      await writeIterationsJournal(journalDir, session._journalIterations || []);
      await writeDecisionsJournal(journalDir, session._journalDecisions || []);
      const hasTree = await writeTreeJournal(journalDir, session.session_start_sha);

      const journalFiles = [...(session._journalFiles || [])];
      if (session._journalIterations?.length) journalFiles.push("iterations.md");
      if (session._journalDecisions?.length) journalFiles.push("decisions.md");
      if (hasTree) journalFiles.push("tree.txt");

      await writeSummaryJournal(journalDir, {
        task: session.task, result: "APPROVED", sessionId: session.id,
        iterations: i, durationMs: Date.now() - (session._startedAt || Date.now()),
        budget: budgetSummary(), stages: stageResults,
        commits: gitResult?.commits || [], files: journalFiles
      });
      logger.info(`Session journal written to ${journalDir}`);
    } catch (err) {
      logger.warn(`Journal write failed (non-blocking): ${err.message}`);
    }
  }

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
    .map((x) => {
      const parts = [`[${x.severity || "high"}] ${x.id || "ISSUE"}: ${x.description || "Missing description"}`];
      if (x.file) parts.push(`  File: ${x.file}${x.line ? `:${x.line}` : ""}`);
      if (x.suggested_fix) parts.push(`  Fix: ${x.suggested_fix}`);
      return parts.join("\n");
    })
    .join("\n\n");
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


async function runPreLoopStages({ config, logger, emitter, eventBase, session, flags, pipelineFlags, coderRole, trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults, brainCtx }) {
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

  // --- Persist inline domain if provided via --domain flag ---
  if (flags?.domain) {
    try {
      await persistInlineDomain(flags.domain, config.projectDir || process.cwd());
    } catch (err) {
      logger.warn(`Failed to persist inline domain: ${err.message}`);
    }
  }

  // --- Domain Curator (after triage + skill auto-install, before planning phases) ---
  const domainHints = triageResult.stageResult?.domainHints || [];
  if (domainHints.length > 0 || config.projectDir) {
    try {
      const { domainContext, stageResult: dcStageResult } = await runDomainCuratorStage({
        config, logger, emitter, eventBase, session, trackBudget,
        domainHints, askQuestion
      });
      stageResults.domainCurator = dcStageResult;
      if (domainContext) {
        config = { ...config, domainContext };
      }
    } catch (err) {
      logger.warn(`Domain Curator failed (non-blocking): ${err.message}`);
    }
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

  // --- Plan injection: skip researcher/architect/planner if a persisted plan is loaded ---
  if (flags.plan) {
    try {
      const { loadPlan } = await import("./plan/plan-store.js");
      const projectDir = updatedConfig.projectDir || process.cwd();
      const loadedPlan = await loadPlan(projectDir, flags.plan);
      if (loadedPlan) {
        logger.info(`Loaded persisted plan: ${flags.plan}`);
        emitProgress(emitter, makeEvent("plan:loaded", { ...eventBase, stage: "plan" }, {
          message: `Plan loaded from kj_plan: ${flags.plan}`,
          detail: { planId: flags.plan, task: loadedPlan.task, createdAt: loadedPlan.createdAt }
        }));
        stageResults.researcher = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
        stageResults.architect = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
        stageResults.planner = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
        // Inject contexts into session for downstream stages
        session.research_context = loadedPlan.researchContext || null;
        session.architect_context = loadedPlan.architectContext || null;
        session.loaded_plan = loadedPlan.plan || null;
        await saveSession(session);

        // Build the planned task from the plan steps
        const plan = loadedPlan.plan;
        let plannedTask = task;
        if (plan && typeof plan === "object" && plan.steps) {
          const stepList = plan.steps.map((s, idx) => `${idx + 1}. ${s.description || s}`).join("\n");
          plannedTask = `${task}\n\n## Implementation Plan\n${plan.approach || ""}\n\n## Steps\n${stepList}`;
        } else if (typeof plan === "string") {
          plannedTask = `${task}\n\n## Implementation Plan\n${plan}`;
        }
        return { plannedTask, updatedConfig };
      }
      logger.warn(`Plan ${flags.plan} not found — falling back to normal pipeline`);
    } catch (err) {
      logger.warn(`Plan loading failed: ${err.message} — falling back to normal pipeline`);
    }
  }

  // --- Researcher → Planner ---
  const { plannedTask } = await runPlanningPhases({ config: updatedConfig, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx });

  // --- Update .gitignore with stack-specific entries based on planner/architect output ---
  const projectDir = updatedConfig.projectDir || process.cwd();
  await updateGitignoreForStack(projectDir, { stageResults, task, logger });

  // --- Auto-install skills based on task + planner output + project detection ---
  // Runs AFTER triage and planner so that the planned task text (which includes
  // planner output like implementation steps) is available for keyword detection.
  // This ensures greenfield projects with no package.json still get correct skills.
  const skillProjectDir = updatedConfig.projectDir || process.cwd();
  try {
    const osAvailable = await isOpenSkillsAvailable();
    if (osAvailable) {
      const neededSkills = await detectNeededSkills(plannedTask, skillProjectDir);
      if (neededSkills.length > 0) {
        const skillResult = await autoInstallSkills(neededSkills, skillProjectDir);
        if (skillResult.installed.length > 0) {
          session.autoInstalledSkills = skillResult.installed;
        }
        emitProgress(emitter, makeEvent("skills:auto-install", { ...eventBase, stage: "skills" }, {
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

  return { plannedTask, updatedConfig };
}

async function runCoderAndRefactorerStages({ coderRoleInstance, coderRole, refactorerRole, pipelineFlags, config, logger, emitter, eventBase, session, plannedTask, trackBudget, i, brainCtx }) {
  const coderResult = await runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i, brainCtx });
  if (coderResult?.action === "pause") return { action: "return", result: coderResult.result };
  const coderStandby = await handleStandbyResult({ stageResult: coderResult, session, emitter, eventBase, i, stage: "coder", logger, config });
  if (coderStandby.handled) {
    return coderStandby.action === "return"
      ? { action: "return", result: coderStandby.result }
      : { action: "retry" };
  }

  if (pipelineFlags.refactorerEnabled) {
    const refResult = await runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
    if (refResult?.action === "pause") return { action: "return", result: refResult.result };
    const refStandby = await handleStandbyResult({ stageResult: refResult, session, emitter, eventBase, i, stage: "refactorer", logger, config });
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
      await tryCiComment({ config, session, logger, agent: "Sonar", body: `SonarQube scan: ${sonarResult.stageResult.summary || "completed"}` });
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
    const impeccableMode = pipelineFlags?.impeccableMode || "audit";
    const impeccableResult = await runImpeccableStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff, mode: impeccableMode
    });
    if (impeccableResult.stageResult) {
      stageResults.impeccable = impeccableResult.stageResult;
    }
  }

  return { action: "ok" };
}

async function runReviewerGateStage({ pipelineFlags, reviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion, brainCtx }) {
  if (!pipelineFlags.reviewerEnabled) {
    return {
      action: "ok",
      review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Reviewer disabled by pipeline", confidence: 1 }
    };
  }

  const reviewerResult = await runReviewerStage({
    reviewerRole, config, logger, emitter, eventBase, session, trackBudget,
    iteration: i, reviewRules, task, repeatDetector, budgetSummary, askQuestion, brainCtx
  });
  if (reviewerResult.action === "pause") return { action: "return", result: reviewerResult.result };
  const revStandby = await handleStandbyResult({ stageResult: reviewerResult, session, emitter, eventBase, i, stage: "reviewer", logger, config, askQuestion });
  if (revStandby.handled) {
    if (revStandby.action === "return") return { action: "return", result: revStandby.result };
    if (revStandby.action === "skip") {
      // Solomon said skip review — treat as approved
      return { action: "ok", review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Review skipped (agent rate-limited, Solomon approved)", confidence: 0.7 } };
    }
    if (revStandby.action === "retry_reviewer_only") {
      // Retry just the reviewer — use alternative agent if Solomon recommended one
      let retryReviewerRole = reviewerRole;
      const alt = session._alternative_agent;
      if (alt?.stage === "reviewer" && alt?.provider) {
        const { createAgent } = await import("./agents/index.js");
        retryReviewerRole = { provider: alt.provider, model: null };
        logger.info(`Retrying reviewer with alternative agent: ${alt.provider}`);
        delete session._alternative_agent;
      }
      return runReviewerGateStage({ pipelineFlags: { reviewerEnabled: true }, reviewerRole: retryReviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion });
    }
    return { action: "retry" };
  }
  if (reviewerResult.stalled) return { action: "return", result: reviewerResult.stalledResult };
  return { action: "ok", review: reviewerResult.review };
}

async function handleApprovedReview({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, pipelineFlags, askQuestion, logger, gitCtx, budgetSummary, pgCard, pgProject, review, rtkTracker, brainCtx }) {
  session.reviewer_retry_count = 0;
  const postLoopResult = await handlePostLoopStages({
    config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults,
    ciEnabled: Boolean(config.ci?.enabled), testerEnabled: pipelineFlags.testerEnabled, securityEnabled: pipelineFlags.securityEnabled, askQuestion, logger, brainCtx
  });
  if (postLoopResult.action === "return") return { action: "return", result: postLoopResult.result };
  if (postLoopResult.action === "continue") return { action: "continue" };

  const result = await finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker });
  return { action: "return", result };
}

async function handleMaxIterationsReached({ session, budgetSummary, emitter, eventBase, config, stageResults, logger, askQuestion, task, rtkTracker, brainCtx }) {
  const budget = budgetSummary();

  // Brain-owned decision: max_iterations is guidance, not a hard rule.
  // Brain evaluates the feedback queue state to decide extend / finalize / escalate.
  // Solomon is only consulted if Brain cannot decide on its own.
  if (brainCtx?.enabled) {
    const entries = brainCtx.feedbackQueue?.entries || [];
    const pending = entries.map(e => ({ source: e.source, category: e.category, severity: e.severity, description: e.description }));
    const hasSecurity = entries.some(e => e.category === "security" || e.source === "security");
    const hasCorrectness = entries.some(e => ["correctness", "tests"].includes(e.category));
    const hasStyleOnly = entries.length > 0 && !hasSecurity && !hasCorrectness;

    if (hasSecurity) {
      // Brain: security issues unresolved → cannot finalize, escalate
      logger.warn(`Brain: max_iterations reached with ${entries.filter(e => e.category === "security" || e.source === "security").length} unresolved security issue(s) — cannot finalize`);
      return { paused: true, sessionId: session.id, question: "Brain: unresolved security issues at max_iterations. Review manually or extend pipeline.", context: "brain_security_block", pending };
    }

    if (hasCorrectness) {
      // Brain: correctness/test issues pending → extend iterations (Brain's decision, not a rule)
      logger.info(`Brain: max_iterations reached with ${entries.filter(e => ["correctness", "tests"].includes(e.category)).length} correctness issue(s) pending — extending iterations`);
      session.reviewer_retry_count = 0;
      await saveSession(session);
      return { approved: false, sessionId: session.id, reason: "max_iterations_extended", extraIterations: Math.ceil(config.max_iterations / 2) };
    }

    if (entries.length === 0) {
      // Brain: no pending feedback → last reviewer approved, finalize
      logger.info("Brain: max_iterations reached with clean feedback queue — finalizing as approved");
      return { approved: true, sessionId: session.id, reason: "brain_approved" };
    }

    // hasStyleOnly: genuine dilemma → Brain consults Solomon
    logger.info(`Brain: max_iterations with ${entries.length} style-only issue(s) — consulting Solomon on dilemma`);
    const { invokeSolomon: invokeSolomonAI } = await import("./orchestrator/solomon-escalation.js");
    const solomonResult = await invokeSolomonAI({
      config, logger, emitter, eventBase, stage: "max_iterations", askQuestion, session,
      iteration: config.max_iterations,
      conflict: {
        stage: "brain-max-iterations",
        task,
        iterationCount: config.max_iterations,
        maxIterations: config.max_iterations,
        budget_usd: budget?.total_cost_usd || 0,
        dilemma: `Max iterations reached with ${entries.length} style-only issue(s) pending. Accept as-is or request more work?`,
        pendingIssues: pending,
        history: [{ agent: "pipeline", feedback: session.last_reviewer_feedback || "Max iterations reached" }]
      }
    });
    // Brain applies Solomon's decision
    if (solomonResult.action === "approve") {
      logger.info("Brain: Solomon advised approve for style-only pending — finalizing");
      return { approved: true, sessionId: session.id, reason: "brain_solomon_approved" };
    }
    if (solomonResult.action === "continue") {
      return { approved: false, sessionId: session.id, reason: "max_iterations_extended", extraIterations: solomonResult.extraIterations || Math.ceil(config.max_iterations / 2) };
    }
    if (solomonResult.action === "pause") {
      return { paused: true, sessionId: session.id, question: solomonResult.question, context: "brain_solomon_dilemma" };
    }
    // Fallback: escalate to human
    return { paused: true, sessionId: session.id, question: `Brain+Solomon cannot resolve: ${entries.length} pending issue(s) at max_iterations`, context: "max_iterations" };
  }

  // Legacy path (Brain disabled): original Solomon-driven flow
  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "max_iterations", askQuestion, session,
    iteration: config.max_iterations,
    conflict: {
      stage: "max_iterations",
      task,
      iterationCount: config.max_iterations,
      maxIterations: config.max_iterations,
      budget_usd: budget?.total_cost_usd || 0,
      history: [{ agent: "pipeline", feedback: session.last_reviewer_feedback || "Max iterations reached without reviewer approval" }]
    }
  });

  if (solomonResult.action === "approve") {
    logger.info("Solomon approved coder's work at max_iterations checkpoint");
    return { approved: true, sessionId: session.id, reason: "solomon_approved" };
  }

  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      session.last_reviewer_feedback = `Solomon guidance: ${solomonResult.humanGuidance}`;
    }
    session.reviewer_retry_count = 0;
    await saveSession(session);
    const extraIterations = solomonResult.extraIterations || config.max_iterations;
    return { approved: false, sessionId: session.id, reason: "max_iterations_extended", humanGuidance: solomonResult.humanGuidance, extraIterations };
  }

  if (solomonResult.action === "pause") {
    return { paused: true, sessionId: session.id, question: solomonResult.question, context: "max_iterations" };
  }

  if (solomonResult.action === "subtask") {
    return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "max_iterations_subtask" };
  }

  // Solomon couldn't resolve — fail
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
  // Auto-init .karajan/ if missing (copies coder-rules, review-rules, role templates)
  const initProjectDir = config.projectDir || process.cwd();
  await autoInit(initProjectDir, logger);

  // Smart role assignment: detect installed AIs and assign to roles
  // Only runs if: (a) no roles configured AND (b) not in test environment
  const needsAssignment = !config.roles?.coder?.provider && !config.coder && process.env.NODE_ENV !== "test" && !process.env.VITEST;
  if (needsAssignment) {
    try {
      const { autoAssignRoles, applyRoleAssignments } = await import("./utils/role-assigner.js");
      const { assignments } = await autoAssignRoles(logger);
      if (assignments) config = applyRoleAssignments({ ...config }, assignments);
    } catch { /* non-blocking — defaults will be used */ }
  }

  // Scope all git diffs to projectDir (prevents leaking unrelated branch changes)
  // When running from a subdirectory of a git repo, use relative path as scope
  let diffScope = config.projectDir || null;
  if (!diffScope) {
    try {
      const { execSync } = await import("node:child_process");
      const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
      const cwd = process.cwd();
      if (cwd !== repoRoot && cwd.startsWith(repoRoot)) {
        diffScope = cwd.slice(repoRoot.length + 1);
        logger.info(`Running from subdirectory — diff scoped to ${diffScope}/`);
      }
    } catch { /* git not available */ }
  }
  setDiffProjectDir(diffScope);

  // Auto-detect Chrome DevTools MCP
  const { detectDevToolsMcp } = await import("./webperf/devtools-detect.js");
  const devToolsAvailable = await detectDevToolsMcp(logger);
  if (devToolsAvailable) {
    config = { ...config, webperf: { ...config.webperf, devtools_mcp: true } };
  }

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

  // Karajan Brain: initialize runtime context (opt-in via config.brain.enabled)
  const { createBrainContext, isBrainEnabled } = await import("./orchestrator/brain-coordinator.js");
  ctx.brainCtx = createBrainContext({ enabled: isBrainEnabled(config) });
  if (ctx.brainCtx.enabled) {
    logger.info("Karajan Brain enabled — feedback queue, verification, compression active");
  }

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

  const preLoopResult = await runPreLoopStages({ config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session, flags, pipelineFlags: ctx.pipelineFlags, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults: ctx.stageResults, brainCtx: ctx.brainCtx });
  ctx.plannedTask = preLoopResult.plannedTask;
  ctx.config = preLoopResult.updatedConfig;

  // --- Session Journal: persist pre-loop outputs + display plan summary ---
  const reportDir = ctx.config.output?.report_dir || ".reviews";
  try {
    ctx.journalDir = await createJournalDir(reportDir, ctx.session.id);
    const journalFiles = await writePreLoopJournal(ctx.journalDir, ctx.stageResults);
    ctx.journalFiles = journalFiles;
    ctx.journalIterations = [];
    ctx.journalDecisions = [];

    // Attach journal state to session so finalizeApprovedSession can access it
    ctx.session._journalDir = ctx.journalDir;
    ctx.session._journalFiles = journalFiles;
    ctx.session._journalIterations = ctx.journalIterations;
    ctx.session._journalDecisions = ctx.journalDecisions;
    ctx.session._startedAt = ctx.startedAt;

    // Display plan summary in console before iteration loop
    const planSummary = buildPlanSummary({
      pipelineFlags: ctx.pipelineFlags,
      config: ctx.config,
      stageResults: ctx.stageResults,
      task
    });
    console.log(planSummary);
  } catch (err) {
    logger.warn(`Journal init failed (non-blocking): ${err.message}`);
    ctx.journalDir = null;
    ctx.journalFiles = [];
    ctx.journalIterations = [];
    ctx.journalDecisions = [];
  }

  ctx.gitCtx = await prepareGitAutomation({ config: ctx.config, task, logger, session: ctx.session });
  const projectDir = ctx.config.projectDir || process.cwd();
  ctx.reviewRules = (await resolveReviewProfile({ mode: ctx.config.review_mode, projectDir })).rules;
  await ctx.coderRoleInstance.init();

  return ctx;
}

async function runSingleIteration(ctx) {
  const { config, logger, emitter, eventBase, session, task, iteration: i } = ctx;

  const iterStart = Date.now();
  const ciEnabled = Boolean(config.ci?.enabled) && ctx.gitCtx?.enabled;
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
    plannedTask: ctx.plannedTask, trackBudget: ctx.trackBudget, i, brainCtx: ctx.brainCtx
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

  await handleCiEarlyPrOrPush({
    ciEnabled, config, session, emitter, eventBase, gitCtx: ctx.gitCtx, task, logger,
    stageResults: ctx.stageResults, i
  });

  const revResult = await runReviewerGateStage({
    pipelineFlags: ctx.pipelineFlags, reviewerRole: ctx.reviewerRole, config, logger, emitter, eventBase,
    session, trackBudget: ctx.trackBudget, i, reviewRules: ctx.reviewRules, task,
    repeatDetector: ctx.repeatDetector, budgetSummary: ctx.budgetSummary, askQuestion: ctx.askQuestion,
    brainCtx: ctx.brainCtx
  });
  if (revResult.action === "return" || revResult.action === "retry") return revResult;
  const review = revResult.review;

  const iterDuration = Date.now() - iterStart;
  emitProgress(emitter, makeEvent("iteration:end", { ...eventBase, stage: "iteration" }, {
    message: `Iteration ${i} completed`, detail: { duration: iterDuration }
  }));
  session.standby_retry_count = 0;

  // --- Journal: record iteration ---
  if (ctx.journalIterations) {
    ctx.journalIterations.push(formatIteration({
      iteration: i,
      coderSummary: ctx.stageResults.coder?.summary || null,
      reviewerSummary: review?.approved ? `Approved: ${review.raw_summary || ""}` : `Rejected: ${(review?.blocking_issues || []).length} blocking issue(s)`,
      sonarSummary: ctx.stageResults.sonar?.summary || null,
      testerSummary: ctx.stageResults.tester?.summary || null,
      securitySummary: ctx.stageResults.security?.summary || null,
      durationMs: iterDuration
    }));
  }

  const solomonResult = await handleSolomonCheck({
    config, session, emitter, eventBase, logger, task, i, askQuestion: ctx.askQuestion,
    ciEnabled, blockingIssues: review?.blocking_issues, brainCtx: ctx.brainCtx
  });
  if (solomonResult.action === "pause") return { action: "return", result: solomonResult.result };

  await handleCiReviewDispatch({ ciEnabled, config, session, review, i, logger });

  if (review.approved) {
    const approvedResult = await handleApprovedReview({
      config, session, emitter, eventBase, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, i, task,
      stageResults: ctx.stageResults, pipelineFlags: ctx.pipelineFlags, askQuestion: ctx.askQuestion, logger,
      gitCtx: ctx.gitCtx, budgetSummary: ctx.budgetSummary, pgCard: ctx.pgCard, pgProject: ctx.pgProject, review,
      rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx
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
      .map((x) => {
        const parts = [`[${x.severity || "high"}] ${x.id || "ISSUE"}: ${x.description || "Missing description"}`];
        if (x.file) parts.push(`  File: ${x.file}${x.line ? `:${x.line}` : ""}`);
        if (x.suggested_fix) parts.push(`  Fix: ${x.suggested_fix}`);
        return parts.join("\n");
      })
      .join("\n\n");
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

    let iterResult;
    try {
      iterResult = await runSingleIteration(ctx);
    } catch (stageError) {
      // ANY unhandled error in a stage = out of normal flow → Solomon decides
      logger.warn(`Stage error caught — escalating to Solomon: ${stageError.message}`);
      const solomonResult = await invokeSolomon({
        config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
        stage: "stage_error", askQuestion, session: ctx.session, iteration: i,
        conflict: {
          stage: "stage_error",
          task: loopTask,
          iterationCount: i,
          maxIterations: ctx.config.max_iterations,
          budget_usd: ctx.budgetSummary()?.total_cost_usd || 0,
          history: [{ agent: "pipeline", feedback: `Stage threw: ${stageError.message}` }]
        }
      });

      if (solomonResult.action === "approve") {
        logger.info("Solomon approved despite stage error");
        return { approved: true, sessionId: ctx.session.id, reason: "solomon_approved_after_error" };
      }
      if (solomonResult.action === "continue") {
        if (solomonResult.humanGuidance) {
          ctx.session.last_reviewer_feedback = `Solomon guidance: ${solomonResult.humanGuidance}`;
        }
        continue; // next iteration
      }
      if (solomonResult.action === "pause") {
        return { paused: true, sessionId: ctx.session.id, question: solomonResult.question, context: "stage_error" };
      }
      // Solomon couldn't resolve — fail
      await markSessionStatus(ctx.session, "failed");
      return { approved: false, sessionId: ctx.session.id, reason: "stage_error", error: stageError.message };
    }

    if (iterResult.action === "return") {
      return iterResult.result;
    }
    if (iterResult.action === "retry") { i -= 1; }
  }

  // Solomon decides whether to extend iterations or stop
  const maxIterResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx });

  // Solomon said "continue" — extend iterations and keep going
  if (maxIterResult.reason === "max_iterations_extended") {
    const extra = maxIterResult.extraIterations || ctx.config.max_iterations;
    ctx.config.max_iterations += extra;
    logger.info(`Solomon extended pipeline by ${extra} iterations (new max: ${ctx.config.max_iterations})`);

    if (maxIterResult.humanGuidance) {
      ctx.session.last_reviewer_feedback = `Solomon guidance: ${maxIterResult.humanGuidance}`;
    }

    // Continue the loop
    while (i < ctx.config.max_iterations) {
      i += 1;
      const elapsedMinutes = (Date.now() - ctx.startedAt) / 60000;

      const cpResult = await handleCheckpoint({
        checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes,
        i, config: ctx.config, budgetTracker: ctx.budgetTracker, stageResults: ctx.stageResults, emitter, eventBase: ctx.eventBase, session: ctx.session, budgetSummary: ctx.budgetSummary, lastCheckpointSnapshot
      });
      if (cpResult.action === "stop") return cpResult.result;
      checkpointDisabled = cpResult.checkpointDisabled;
      lastCheckpointAt = cpResult.lastCheckpointAt;
      if (cpResult.lastCheckpointSnapshot !== undefined) lastCheckpointSnapshot = cpResult.lastCheckpointSnapshot;

      await checkSessionTimeout({ askQuestion, elapsedMinutes, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetSummary: ctx.budgetSummary });
      await checkBudgetExceeded({ budgetTracker: ctx.budgetTracker, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetLimit: ctx.budgetLimit, budgetSummary: ctx.budgetSummary });

      ctx.eventBase.iteration = i;
      ctx.iteration = i;

      const iterResult = await runSingleIteration(ctx);
      if (iterResult.action === "return") return iterResult.result;
      if (iterResult.action === "retry") { i -= 1; }
    }

    // Extended iterations also exhausted — final Solomon call
    const finalResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx });
    return finalResult;
  }

  return maxIterResult;
}

export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null, pgTaskId = null, pgProject = null }) {
  const pipelineFlags = resolvePipelineFlags(config);

  if (flags.dryRun) {
    return handleDryRun({ task, config, flags, emitter, pipelineFlags });
  }

  let ctx;
  try {
    ctx = await initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags });
  } catch (initError) {
    // Pre-loop stage failure → Solomon decides
    logger.warn(`Init/pre-loop error — escalating to Solomon: ${initError.message}`);
    const tempSession = { id: "init-error", task, status: "failed" };
    const solomonResult = await invokeSolomon({
      config, logger, emitter, eventBase: { sessionId: "init-error", iteration: 0, stage: "init", startedAt: Date.now() },
      stage: "init_error", askQuestion, session: tempSession, iteration: 0,
      conflict: {
        stage: "init_error",
        task,
        iterationCount: 0,
        maxIterations: config.max_iterations || 5,
        history: [{ agent: "pipeline", feedback: `Initialization failed: ${initError.message}` }]
      }
    });
    if (solomonResult.action === "pause") {
      return { paused: true, sessionId: "init-error", question: solomonResult.question, context: "init_error" };
    }
    throw initError; // Solomon couldn't resolve — propagate
  }

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

    // --- Telemetry: anonymous pipeline_complete event (non-blocking) ---
    try {
      const { sendTelemetryEvent } = await import("./utils/telemetry.js");
      const durationS = Math.round((Date.now() - ctx.startedAt) / 1000);
      const sessionStatus = ctx.session?.status || "unknown";
      sendTelemetryEvent("pipeline_complete", {
        mode: config.review_mode,
        agent: ctx.coderRole?.provider || config.coder,
        duration_s: durationS,
        success: sessionStatus === "approved",
        taskType: ctx.session?.resolved_policies?.taskType || null
      }, config).catch(() => {});
    } catch { /* non-blocking */ }
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
