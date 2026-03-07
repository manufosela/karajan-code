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
  finalizeGitAutomation
} from "./git/automation.js";
import { resolveRoleMdPath, loadFirstExisting } from "./roles/base-role.js";
import { resolveReviewProfile } from "./review/profiles.js";
import { CoderRole } from "./roles/coder-role.js";
import { invokeSolomon } from "./orchestrator/solomon-escalation.js";
import { runTriageStage, runResearcherStage, runPlannerStage } from "./orchestrator/pre-loop-stages.js";
import { runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runReviewerStage } from "./orchestrator/iteration-stages.js";
import { runTesterStage, runSecurityStage } from "./orchestrator/post-loop-stages.js";
import { waitForCooldown, MAX_STANDBY_RETRIES } from "./orchestrator/standby.js";



export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null, pgTaskId = null, pgProject = null }) {
  const plannerRole = resolveRole(config, "planner");
  const coderRole = resolveRole(config, "coder");
  const reviewerRole = resolveRole(config, "reviewer");
  const refactorerRole = resolveRole(config, "refactorer");
  let plannerEnabled = Boolean(config.pipeline?.planner?.enabled);
  let refactorerEnabled = Boolean(config.pipeline?.refactorer?.enabled);
  let researcherEnabled = Boolean(config.pipeline?.researcher?.enabled);
  let testerEnabled = Boolean(config.pipeline?.tester?.enabled);
  let securityEnabled = Boolean(config.pipeline?.security?.enabled);
  let reviewerEnabled = config.pipeline?.reviewer?.enabled !== false;
  const triageEnabled = Boolean(config.pipeline?.triage?.enabled);

  // --- Dry-run: return summary without executing anything ---
  if (flags.dryRun) {
    const projectDir = config.projectDir || process.cwd();
    const { rules: reviewRules } = await resolveReviewProfile({ mode: config.review_mode, projectDir });
    const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));
    const coderPrompt = buildCoderPrompt({ task, coderRules, methodology: config.development?.methodology, serenaEnabled: Boolean(config.serena?.enabled) });
    const reviewerPrompt = buildReviewerPrompt({ task, diff: "(dry-run: no diff)", reviewRules, mode: config.review_mode, serenaEnabled: Boolean(config.serena?.enabled) });

    const summary = {
      dry_run: true,
      task,
      roles: {
        planner: plannerRole,
        coder: coderRole,
        reviewer: reviewerRole,
        refactorer: refactorerRole
      },
      pipeline: {
        triage_enabled: triageEnabled,
        planner_enabled: plannerEnabled,
        refactorer_enabled: refactorerEnabled,
        sonar_enabled: Boolean(config.sonarqube?.enabled),
        reviewer_enabled: reviewerEnabled,
        researcher_enabled: researcherEnabled,
        tester_enabled: testerEnabled,
        security_enabled: securityEnabled,
        solomon_enabled: Boolean(config.pipeline?.solomon?.enabled)
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
      prompts: {
        coder: coderPrompt,
        reviewer: reviewerPrompt
      },
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

  const repeatDetector = new RepeatDetector({ threshold: getRepeatThreshold(config) });
  const coderRoleInstance = new CoderRole({ config, logger, emitter, createAgentFn: createAgent });
  const startedAt = Date.now();
  const eventBase = { sessionId: null, iteration: 0, stage: null, startedAt };
  const budgetTracker = new BudgetTracker({ pricing: config?.budget?.pricing });
  const budgetLimit = Number(config?.max_budget_usd);
  const hasBudgetLimit = Number.isFinite(budgetLimit) && budgetLimit >= 0;
  const warnThresholdPct = Number(config?.budget?.warn_threshold_pct ?? 80);

  function budgetSummary() {
    const s = budgetTracker.summary();
    s.trace = budgetTracker.trace();
    return s;
  }

  let stageCounter = 0;
  function trackBudget({ role, provider, model, result, duration_ms }) {
    const metrics = extractUsageMetrics(result, model);
    budgetTracker.record({ role, provider, ...metrics, duration_ms, stage_index: stageCounter++ });

    if (!hasBudgetLimit) return;
    const totalCost = budgetTracker.total().cost_usd;
    const pctUsed = budgetLimit === 0 ? 100 : (totalCost / budgetLimit) * 100;
    const status = totalCost > budgetLimit ? "fail" : pctUsed >= warnThresholdPct ? "paused" : "ok";
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
          remaining_usd: budgetTracker.remaining(budgetLimit)
        }
      })
    );
  }

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
  const session = await createSession(sessionInit);

  eventBase.sessionId = session.id;

  // --- Planning Game: mark card as In Progress ---
  let pgCard = null;
  if (pgTaskId && pgProject && config.planning_game?.enabled !== false) {
    try {
      const { fetchCard, updateCard } = await import("./planning-game/client.js");
      pgCard = await fetchCard({ projectId: pgProject, cardId: pgTaskId });
      if (pgCard && pgCard.status !== "In Progress") {
        await updateCard({
          projectId: pgProject,
          cardId: pgTaskId,
          firebaseId: pgCard.firebaseId,
          updates: {
            status: "In Progress",
            startDate: new Date().toISOString(),
            developer: "dev_016",
            codeveloper: config.planning_game?.codeveloper || null
          }
        });
        logger.info(`Planning Game: ${pgTaskId} → In Progress`);
      }
    } catch (err) {
      logger.warn(`Planning Game: could not update ${pgTaskId}: ${err.message}`);
    }
  }
  session.pg_card = pgCard || null;

  emitProgress(
    emitter,
    makeEvent("session:start", eventBase, {
      message: "Session started",
      detail: {
        task,
        coder: coderRole.provider,
        reviewer: reviewerRole.provider,
        maxIterations: config.max_iterations
      }
    })
  );

  // Accumulate stage results for final summary
  const stageResults = {};
  const sonarState = { issuesInitial: null, issuesFinal: null };

  if (triageEnabled) {
    const triageResult = await runTriageStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    if (triageResult.roleOverrides.plannerEnabled !== undefined) plannerEnabled = triageResult.roleOverrides.plannerEnabled;
    if (triageResult.roleOverrides.researcherEnabled !== undefined) researcherEnabled = triageResult.roleOverrides.researcherEnabled;
    if (triageResult.roleOverrides.refactorerEnabled !== undefined) refactorerEnabled = triageResult.roleOverrides.refactorerEnabled;
    if (triageResult.roleOverrides.reviewerEnabled !== undefined) reviewerEnabled = triageResult.roleOverrides.reviewerEnabled;
    if (triageResult.roleOverrides.testerEnabled !== undefined) testerEnabled = triageResult.roleOverrides.testerEnabled;
    if (triageResult.roleOverrides.securityEnabled !== undefined) securityEnabled = triageResult.roleOverrides.securityEnabled;
    stageResults.triage = triageResult.stageResult;

    // --- PG decomposition: offer to create subtasks in Planning Game ---
    const pgDecompose = triageResult.stageResult?.shouldDecompose
      && triageResult.stageResult.subtasks?.length > 1
      && pgTaskId
      && pgProject
      && config.planning_game?.enabled !== false
      && askQuestion;

    if (pgDecompose) {
      try {
        const { buildDecompositionQuestion, createDecompositionSubtasks } = await import("./planning-game/decomposition.js");
        const { createCard, relateCards, fetchCard } = await import("./planning-game/client.js");

        const question = buildDecompositionQuestion(triageResult.stageResult.subtasks, pgTaskId);
        const answer = await askQuestion(question);

        if (answer && (answer.trim().toLowerCase() === "yes" || answer.trim().toLowerCase() === "sí" || answer.trim().toLowerCase() === "si")) {
          const parentCard = await fetchCard({ projectId: pgProject, cardId: pgTaskId }).catch(() => null);
          const createdSubtasks = await createDecompositionSubtasks({
            client: { createCard, relateCards },
            projectId: pgProject,
            parentCardId: pgTaskId,
            parentFirebaseId: parentCard?.firebaseId || null,
            subtasks: triageResult.stageResult.subtasks,
            epic: parentCard?.epic || null,
            sprint: parentCard?.sprint || null,
            codeveloper: config.planning_game?.codeveloper || null
          });

          stageResults.triage.pgSubtasks = createdSubtasks;
          logger.info(`Planning Game: created ${createdSubtasks.length} subtasks from decomposition`);

          emitProgress(
            emitter,
            makeEvent("pg:decompose", { ...eventBase, stage: "triage" }, {
              message: `Created ${createdSubtasks.length} subtasks in Planning Game`,
              detail: { subtasks: createdSubtasks.map((s) => ({ cardId: s.cardId, title: s.title })) }
            })
          );

          await addCheckpoint(session, {
            stage: "pg-decompose",
            subtasksCreated: createdSubtasks.length,
            cardIds: createdSubtasks.map((s) => s.cardId)
          });
        }
      } catch (err) {
        logger.warn(`Planning Game decomposition failed: ${err.message}`);
      }
    }
  }

  if (flags.enablePlanner !== undefined) plannerEnabled = Boolean(flags.enablePlanner);
  if (flags.enableResearcher !== undefined) researcherEnabled = Boolean(flags.enableResearcher);
  if (flags.enableRefactorer !== undefined) refactorerEnabled = Boolean(flags.enableRefactorer);
  if (flags.enableReviewer !== undefined) reviewerEnabled = Boolean(flags.enableReviewer);
  if (flags.enableTester !== undefined) testerEnabled = Boolean(flags.enableTester);
  if (flags.enableSecurity !== undefined) securityEnabled = Boolean(flags.enableSecurity);

  // --- Researcher (pre-planning) ---
  let researchContext = null;
  if (researcherEnabled) {
    const researcherResult = await runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    researchContext = researcherResult.researchContext;
    stageResults.researcher = researcherResult.stageResult;
  }

  // --- Planner ---
  let plannedTask = task;
  const triageDecomposition = stageResults.triage?.shouldDecompose ? stageResults.triage.subtasks : null;
  if (plannerEnabled) {
    const plannerResult = await runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, triageDecomposition, trackBudget });
    plannedTask = plannerResult.plannedTask;
    stageResults.planner = plannerResult.stageResult;
  }

  const gitCtx = await prepareGitAutomation({ config, task, logger, session });

  const projectDir = config.projectDir || process.cwd();
  const { rules: reviewRules } = await resolveReviewProfile({ mode: config.review_mode, projectDir });
  await coderRoleInstance.init();

  const checkpointIntervalMs = (config.session.checkpoint_interval_minutes ?? 5) * 60 * 1000;
  let lastCheckpointAt = Date.now();
  let checkpointDisabled = false;

  for (let i = 1; i <= config.max_iterations; i += 1) {
    const elapsedMinutes = (Date.now() - startedAt) / 60000;

    // --- Interactive checkpoint: pause and ask every N minutes ---
    if (!checkpointDisabled && askQuestion && (Date.now() - lastCheckpointAt) >= checkpointIntervalMs) {
      const elapsedStr = elapsedMinutes.toFixed(1);
      const iterInfo = `${i - 1}/${config.max_iterations} iterations completed`;
      const budgetInfo = budgetTracker.total().cost_usd > 0 ? ` | Budget: $${budgetTracker.total().cost_usd.toFixed(2)}` : "";
      const stagesCompleted = Object.keys(stageResults).join(", ") || "none";
      const checkpointMsg = `Checkpoint — ${elapsedStr} min elapsed | ${iterInfo}${budgetInfo} | Stages completed: ${stagesCompleted}. What would you like to do?`;

      emitProgress(
        emitter,
        makeEvent("session:checkpoint", { ...eventBase, iteration: i, stage: "checkpoint" }, {
          message: `Interactive checkpoint at ${elapsedStr} min`,
          detail: { elapsed_minutes: Number(elapsedStr), iterations_done: i - 1, stages: stagesCompleted }
        })
      );

      const answer = await askQuestion(
        `${checkpointMsg}\n\nOptions:\n1. Continue 5 more minutes\n2. Continue until done (no more checkpoints)\n3. Continue for N minutes (reply with the number)\n4. Stop now`
      );

      await addCheckpoint(session, { stage: "interactive-checkpoint", elapsed_minutes: Number(elapsedStr), answer });

      // Explicit stop: only when the user clearly chose option 4 or typed "stop".
      // A null/empty answer (e.g. elicitInput failure, AI timeout) defaults to
      // "continue 5 more minutes" so the session is not killed accidentally.
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
        return { approved: false, sessionId: session.id, reason: "user_stopped", elapsed_minutes: Number(elapsedStr) };
      }

      // No answer or unrecognized → default to continue 5 more minutes
      if (!trimmedAnswer) {
        lastCheckpointAt = Date.now();
      } else if (trimmedAnswer === "2" || trimmedAnswer.toLowerCase().startsWith("continue until")) {
        checkpointDisabled = true;
      } else if (trimmedAnswer === "1" || trimmedAnswer.toLowerCase().includes("5 m")) {
        lastCheckpointAt = Date.now();
      } else {
        const customMinutes = parseInt(trimmedAnswer.replace(/\D/g, ""), 10);
        if (customMinutes > 0) {
          lastCheckpointAt = Date.now();
          config.session.checkpoint_interval_minutes = customMinutes;
        } else {
          lastCheckpointAt = Date.now();
        }
      }
    }

    // --- Hard timeout: only when no askQuestion available ---
    if (!askQuestion && elapsedMinutes > config.session.max_total_minutes) {
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

    if (budgetTracker.isOverBudget(config?.max_budget_usd)) {
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

    eventBase.iteration = i;
    const iterStart = Date.now();
    logger.setContext({ iteration: i, stage: "iteration" });

    emitProgress(
      emitter,
      makeEvent("iteration:start", { ...eventBase, stage: "iteration" }, {
        message: `Iteration ${i}/${config.max_iterations}`,
        detail: { iteration: i, maxIterations: config.max_iterations }
      })
    );

    logger.info(`Iteration ${i}/${config.max_iterations}`);

    // --- Coder ---
    const coderResult = await runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
    if (coderResult?.action === "pause") {
      return coderResult.result;
    }
    if (coderResult?.action === "standby") {
      const standbyRetries = session.standby_retry_count || 0;
      if (standbyRetries >= MAX_STANDBY_RETRIES) {
        await pauseSession(session, {
          question: `Rate limit standby exhausted after ${standbyRetries} retries. Agent: ${coderResult.standbyInfo.agent}`,
          context: { iteration: i, stage: "coder", reason: "standby_exhausted" }
        });
        emitProgress(emitter, makeEvent("coder:rate_limit", { ...eventBase, stage: "coder" }, {
          status: "paused",
          message: `Standby exhausted after ${standbyRetries} retries`,
          detail: { agent: coderResult.standbyInfo.agent, sessionId: session.id }
        }));
        return { paused: true, sessionId: session.id, question: `Rate limit standby exhausted after ${standbyRetries} retries`, context: "standby_exhausted" };
      }
      session.standby_retry_count = standbyRetries + 1;
      await saveSession(session);
      await waitForCooldown({ ...coderResult.standbyInfo, retryCount: standbyRetries, emitter, eventBase, logger, session });
      i -= 1; // Retry the same iteration
      continue;
    }

    // --- Refactorer ---
    if (refactorerEnabled) {
      const refResult = await runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
      if (refResult?.action === "pause") {
        return refResult.result;
      }
      if (refResult?.action === "standby") {
        const standbyRetries = session.standby_retry_count || 0;
        if (standbyRetries >= MAX_STANDBY_RETRIES) {
          await pauseSession(session, {
            question: `Rate limit standby exhausted after ${standbyRetries} retries. Agent: ${refResult.standbyInfo.agent}`,
            context: { iteration: i, stage: "refactorer", reason: "standby_exhausted" }
          });
          emitProgress(emitter, makeEvent("refactorer:rate_limit", { ...eventBase, stage: "refactorer" }, {
            status: "paused",
            message: `Standby exhausted after ${standbyRetries} retries`,
            detail: { agent: refResult.standbyInfo.agent, sessionId: session.id }
          }));
          return { paused: true, sessionId: session.id, question: `Rate limit standby exhausted after ${standbyRetries} retries`, context: "standby_exhausted" };
        }
        session.standby_retry_count = standbyRetries + 1;
        await saveSession(session);
        await waitForCooldown({ ...refResult.standbyInfo, retryCount: standbyRetries, emitter, eventBase, logger, session });
        i -= 1; // Retry the same iteration
        continue;
      }
    }

    // --- TDD Policy ---
    const tddResult = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: i, askQuestion });
    if (tddResult.action === "pause") {
      return tddResult.result;
    }
    if (tddResult.action === "continue") {
      continue;
    }

    // --- SonarQube ---
    if (config.sonarqube.enabled) {
      const sonarResult = await runSonarStage({
        config, logger, emitter, eventBase, session, trackBudget, iteration: i,
        repeatDetector, budgetSummary, sonarState,
        askQuestion, task
      });
      if (sonarResult.action === "stalled" || sonarResult.action === "pause") {
        return sonarResult.result;
      }
      if (sonarResult.action === "continue") {
        continue;
      }
      if (sonarResult.stageResult) {
        stageResults.sonar = sonarResult.stageResult;
      }
    }

    // --- Reviewer ---
    let review = {
      approved: true,
      blocking_issues: [],
      non_blocking_suggestions: [],
      summary: "Reviewer disabled by pipeline",
      confidence: 1
    };
    if (reviewerEnabled) {
      const reviewerResult = await runReviewerStage({
        reviewerRole, config, logger, emitter, eventBase, session, trackBudget,
        iteration: i, reviewRules, task, repeatDetector, budgetSummary, askQuestion
      });
      if (reviewerResult.action === "pause") {
        return reviewerResult.result;
      }
      if (reviewerResult.action === "standby") {
        const standbyRetries = session.standby_retry_count || 0;
        if (standbyRetries >= MAX_STANDBY_RETRIES) {
          await pauseSession(session, {
            question: `Rate limit standby exhausted after ${standbyRetries} retries. Agent: ${reviewerResult.standbyInfo.agent}`,
            context: { iteration: i, stage: "reviewer", reason: "standby_exhausted" }
          });
          emitProgress(emitter, makeEvent("reviewer:rate_limit", { ...eventBase, stage: "reviewer" }, {
            status: "paused",
            message: `Standby exhausted after ${standbyRetries} retries`,
            detail: { agent: reviewerResult.standbyInfo.agent, sessionId: session.id }
          }));
          return { paused: true, sessionId: session.id, question: `Rate limit standby exhausted after ${standbyRetries} retries`, context: "standby_exhausted" };
        }
        session.standby_retry_count = standbyRetries + 1;
        await saveSession(session);
        await waitForCooldown({ ...reviewerResult.standbyInfo, retryCount: standbyRetries, emitter, eventBase, logger, session });
        i -= 1; // Retry the same iteration
        continue;
      }
      review = reviewerResult.review;
      if (reviewerResult.stalled) {
        return reviewerResult.stalledResult;
      }
    }

    // --- Iteration end ---
    const iterDuration = Date.now() - iterStart;
    emitProgress(
      emitter,
      makeEvent("iteration:end", { ...eventBase, stage: "iteration" }, {
        message: `Iteration ${i} completed`,
        detail: { duration: iterDuration }
      })
    );

    // Reset standby counter after successful iteration
    session.standby_retry_count = 0;

    // --- Solomon supervisor: anomaly detection after each iteration ---
    if (config.pipeline?.solomon?.enabled !== false) {
      try {
        const { evaluateRules, buildRulesContext } = await import("./orchestrator/solomon-rules.js");
        const rulesContext = await buildRulesContext({ session, task, iteration: i });
        const rulesResult = evaluateRules(rulesContext, config.solomon?.rules);

        if (rulesResult.alerts.length > 0) {
          for (const alert of rulesResult.alerts) {
            emitProgress(emitter, makeEvent("solomon:alert", { ...eventBase, stage: "solomon" }, {
              status: alert.severity === "critical" ? "fail" : "warn",
              message: alert.message,
              detail: alert.detail
            }));
            logger.warn(`Solomon alert [${alert.rule}]: ${alert.message}`);
          }

          if (rulesResult.hasCritical && askQuestion) {
            const alertSummary = rulesResult.alerts
              .filter(a => a.severity === "critical")
              .map(a => a.message)
              .join("\n");
            const answer = await askQuestion(
              `Solomon detected critical issues:\n${alertSummary}\n\nShould I continue, pause, or revert?`,
              { iteration: i, stage: "solomon" }
            );
            if (!answer || answer.toLowerCase().includes("pause") || answer.toLowerCase().includes("stop")) {
              await pauseSession(session, {
                question: `Solomon supervisor paused: ${alertSummary}`,
                context: { iteration: i, stage: "solomon", alerts: rulesResult.alerts }
              });
              return { paused: true, sessionId: session.id, reason: "solomon_alert" };
            }
          }
        }
      } catch (err) {
        logger.warn(`Solomon rules evaluation failed: ${err.message}`);
      }
    }

    if (review.approved) {
      session.reviewer_retry_count = 0;

      // --- Post-loop stages: Tester → Security ---
      const postLoopDiff = await generateDiff({ baseRef: session.session_start_sha });

      if (testerEnabled) {
        const testerResult = await runTesterStage({
          config, logger, emitter, eventBase, session, coderRole, trackBudget,
          iteration: i, task, diff: postLoopDiff, askQuestion
        });
        if (testerResult.action === "pause") {
          return testerResult.result;
        }
        if (testerResult.action === "continue") {
          continue;
        }
        if (testerResult.stageResult) {
          stageResults.tester = testerResult.stageResult;
        }
      }

      if (securityEnabled) {
        const securityResult = await runSecurityStage({
          config, logger, emitter, eventBase, session, coderRole, trackBudget,
          iteration: i, task, diff: postLoopDiff, askQuestion
        });
        if (securityResult.action === "pause") {
          return securityResult.result;
        }
        if (securityResult.action === "continue") {
          continue;
        }
        if (securityResult.stageResult) {
          stageResults.security = securityResult.stageResult;
        }
      }

      // --- All post-loop checks passed → finalize ---
      const gitResult = await finalizeGitAutomation({ config, gitCtx, task, logger, session, stageResults });
      if (stageResults.planner?.ok) {
        stageResults.planner.completedSteps = [...(stageResults.planner.steps || [])];
      }
      session.budget = budgetSummary();
      await markSessionStatus(session, "approved");

      // --- Planning Game: mark card as To Validate ---
      if (pgCard && pgProject) {
        try {
          const { updateCard } = await import("./planning-game/client.js");
          const { buildCompletionUpdates } = await import("./planning-game/adapter.js");
          const pgUpdates = buildCompletionUpdates({
            approved: true,
            commits: gitResult?.commits || [],
            startDate: session.pg_card?.startDate || session.created_at,
            codeveloper: config.planning_game?.codeveloper || null
          });
          await updateCard({
            projectId: pgProject,
            cardId: session.pg_task_id,
            firebaseId: pgCard.firebaseId,
            updates: pgUpdates
          });
          logger.info(`Planning Game: ${session.pg_task_id} → To Validate`);
        } catch (err) {
          logger.warn(`Planning Game: could not update ${session.pg_task_id} on completion: ${err.message}`);
        }
      }

      const deferredIssues = session.deferred_issues || [];
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, stage: "done" }, {
          message: deferredIssues.length > 0
            ? `Session approved (${deferredIssues.length} deferred issue(s) tracked as tech debt)`
            : "Session approved",
          detail: { approved: true, iterations: i, stages: stageResults, git: gitResult, budget: budgetSummary(), deferredIssues }
        })
      );
      return { approved: true, sessionId: session.id, review, git: gitResult, deferredIssues };
    }

    session.last_reviewer_feedback = review.blocking_issues
      .map((x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`)
      .join("\n");
    session.reviewer_retry_count = (session.reviewer_retry_count || 0) + 1;
    await saveSession(session);

    const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
    if (session.reviewer_retry_count >= maxReviewerRetries) {
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
        return { paused: true, sessionId: session.id, question: solomonResult.question, context: "reviewer_fail_fast" };
      }
      if (solomonResult.action === "continue") {
        if (solomonResult.humanGuidance) {
          session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
        }
        session.reviewer_retry_count = 0;
        await saveSession(session);
        continue;
      }
      if (solomonResult.action === "subtask") {
        return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "reviewer_subtask" };
      }
    }
  }

  session.budget = budgetSummary();
  await markSessionStatus(session, "failed");
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      status: "fail",
      message: "Max iterations reached",
      detail: { approved: false, reason: "max_iterations", iterations: config.max_iterations, stages: stageResults, budget: budgetSummary() }
    })
  );
  return { approved: false, sessionId: session.id, reason: "max_iterations" };
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
  const resumableStatuses = ["running", "stopped", "failed"];
  if (!resumableStatuses.includes(session.status)) {
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
  return runFlow({ task, config: sessionConfig, logger, flags, emitter, askQuestion });
}
