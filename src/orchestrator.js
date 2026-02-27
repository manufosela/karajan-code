import { createAgent } from "./agents/index.js";
import {
  addCheckpoint,
  createSession,
  loadSession,
  markSessionStatus,
  pauseSession,
  resumeSessionWithAnswer,
  saveSession
} from "./session-store.js";
import { computeBaseRef, generateDiff } from "./review/diff-generator.js";
import { parseJsonOutput } from "./review/parser.js";
import { validateReviewResult } from "./review/schema.js";
import { evaluateTddPolicy } from "./review/tdd-policy.js";
import { buildCoderPrompt } from "./prompts/coder.js";
import { buildReviewerPrompt } from "./prompts/reviewer.js";
import { resolveRole } from "./config.js";
import { SonarRole } from "./roles/sonar-role.js";
import { RepeatDetector } from "./repeat-detector.js";
import { emitProgress, makeEvent } from "./utils/events.js";
import { BudgetTracker } from "./utils/budget.js";
import {
  commitMessageFromTask,
  prepareGitAutomation,
  finalizeGitAutomation
} from "./git/automation.js";
import { resolveRoleMdPath, loadFirstExisting } from "./roles/base-role.js";
import { resolveReviewProfile } from "./review/profiles.js";
import { ResearcherRole } from "./roles/researcher-role.js";
import { TesterRole } from "./roles/tester-role.js";
import { SecurityRole } from "./roles/security-role.js";
import { SolomonRole } from "./roles/solomon-role.js";

function parsePlannerOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let title = null;
  let approach = null;
  const steps = [];

  for (const line of lines) {
    if (!title) {
      const titleMatch = line.match(/^title\s*:\s*(.+)$/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
        continue;
      }
    }

    if (!approach) {
      const approachMatch = line.match(/^(approach|strategy)\s*:\s*(.+)$/i);
      if (approachMatch) {
        approach = approachMatch[2].trim();
        continue;
      }
    }

    const numberedStep = line.match(/^\d+[\).:-]\s*(.+)$/);
    if (numberedStep) {
      steps.push(numberedStep[1].trim());
      continue;
    }

    const bulletStep = line.match(/^[-*]\s+(.+)$/);
    if (bulletStep) {
      steps.push(bulletStep[1].trim());
      continue;
    }
  }

  if (!title) {
    const firstFreeLine = lines.find((line) => !/^(approach|strategy)\s*:/i.test(line) && !/^\d+[\).:-]\s*/.test(line));
    title = firstFreeLine || null;
  }

  return { title, approach, steps };
}

function getRepeatThreshold(config) {
  const raw =
    config?.failFast?.repeatThreshold ??
    config?.session?.repeat_detection_threshold ??
    config?.session?.fail_fast_repeats ??
    2;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  return 2;
}

function extractUsageMetrics(result) {
  const usage = result?.usage || result?.metrics || {};
  const tokens_in =
    result?.tokens_in ??
    usage?.tokens_in ??
    usage?.input_tokens ??
    usage?.prompt_tokens ??
    0;
  const tokens_out =
    result?.tokens_out ??
    usage?.tokens_out ??
    usage?.output_tokens ??
    usage?.completion_tokens ??
    0;
  const cost_usd =
    result?.cost_usd ??
    usage?.cost_usd ??
    usage?.usd_cost ??
    usage?.cost ??
    0;

  return { tokens_in, tokens_out, cost_usd };
}

async function runReviewerWithFallback({ reviewerName, config, logger, prompt, session, iteration, onOutput, onAttemptResult }) {
  const fallbackReviewer = config.reviewer_options?.fallback_reviewer;
  const retries = Math.max(0, Number(config.reviewer_options?.retries ?? 1));
  const candidates = [reviewerName];
  if (fallbackReviewer && fallbackReviewer !== reviewerName) {
    candidates.push(fallbackReviewer);
  }

  const attempts = [];
  for (const name of candidates) {
    const reviewer = createAgent(name, config, logger);
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const result = await reviewer.reviewTask({ prompt, onOutput, role: "reviewer" });
      if (onAttemptResult) {
        await onAttemptResult({ reviewer: name, result });
      }
      attempts.push({ reviewer: name, attempt, ok: result.ok, result });
      await addCheckpoint(session, {
        stage: "reviewer-attempt",
        iteration,
        reviewer: name,
        attempt,
        ok: result.ok
      });

      if (result.ok) {
        return { result, attempts };
      }
    }
  }

  return { result: null, attempts };
}

async function invokeSolomon({ config, logger, emitter, eventBase, stage, conflict, askQuestion, session, iteration }) {
  const solomonEnabled = Boolean(config.pipeline?.solomon?.enabled);

  if (!solomonEnabled) {
    return escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration });
  }

  emitProgress(
    emitter,
    makeEvent("solomon:start", { ...eventBase, stage: "solomon" }, {
      message: `Solomon arbitrating ${stage} conflict`,
      detail: { conflictStage: stage }
    })
  );

  const solomon = new SolomonRole({ config, logger, emitter });
  await solomon.init({ task: conflict.task || session.task, iteration });
  const ruling = await solomon.run({ conflict });

  emitProgress(
    emitter,
    makeEvent("solomon:end", { ...eventBase, stage: "solomon" }, {
      message: `Solomon ruling: ${ruling.result?.ruling || "unknown"}`,
      detail: ruling.result
    })
  );

  await addCheckpoint(session, {
    stage: "solomon",
    iteration,
    ruling: ruling.result?.ruling,
    escalate: ruling.result?.escalate,
    subtask: ruling.result?.subtask?.title || null
  });

  if (!ruling.ok) {
    // escalate_human
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: ruling.result?.escalate_reason }
    });
  }

  const r = ruling.result?.ruling;
  if (r === "approve" || r === "approve_with_conditions") {
    return { action: "continue", conditions: ruling.result?.conditions || [], ruling };
  }

  if (r === "create_subtask") {
    return { action: "subtask", subtask: ruling.result?.subtask, ruling };
  }

  return { action: "continue", conditions: [], ruling };
}

async function escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration }) {
  const reason = conflict?.solomonReason || `${stage} conflict unresolved`;
  const question = `${stage} conflict requires human intervention: ${reason}\nDetails: ${JSON.stringify(conflict?.history?.slice(-2) || [], null, 2)}\n\nHow should we proceed?`;

  if (askQuestion) {
    const answer = await askQuestion(question, { iteration, stage });
    if (answer) {
      return { action: "continue", humanGuidance: answer };
    }
  }

  await pauseSession(session, {
    question,
    context: { iteration, stage, conflict }
  });
  emitProgress(
    emitter,
    makeEvent("question", { ...eventBase, stage }, {
      status: "paused",
      message: question,
      detail: { question, sessionId: session.id }
    })
  );

  return { action: "pause", question };
}

export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null }) {
  const plannerRole = resolveRole(config, "planner");
  const coderRole = resolveRole(config, "coder");
  const reviewerRole = resolveRole(config, "reviewer");
  const refactorerRole = resolveRole(config, "refactorer");
  const plannerEnabled = Boolean(config.pipeline?.planner?.enabled);
  const refactorerEnabled = Boolean(config.pipeline?.refactorer?.enabled);
  const researcherEnabled = Boolean(config.pipeline?.researcher?.enabled);
  const testerEnabled = Boolean(config.pipeline?.tester?.enabled);
  const securityEnabled = Boolean(config.pipeline?.security?.enabled);

  // --- Dry-run: return summary without executing anything ---
  if (flags.dryRun) {
    const projectDir = config.projectDir || process.cwd();
    const { rules: reviewRules } = await resolveReviewProfile({ mode: config.review_mode, projectDir });
    const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));
    const coderPrompt = buildCoderPrompt({ task, coderRules, methodology: config.development?.methodology });
    const reviewerPrompt = buildReviewerPrompt({ task, diff: "(dry-run: no diff)", reviewRules, mode: config.review_mode });

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
        planner_enabled: plannerEnabled,
        refactorer_enabled: refactorerEnabled,
        sonar_enabled: Boolean(config.sonarqube?.enabled),
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
  const coder = createAgent(coderRole.provider, config, logger);
  const startedAt = Date.now();
  const eventBase = { sessionId: null, iteration: 0, stage: null, startedAt };
  const budgetTracker = new BudgetTracker();
  const budgetLimit = Number(config?.max_budget_usd);
  const hasBudgetLimit = Number.isFinite(budgetLimit) && budgetLimit >= 0;
  const warnThresholdPct = Number(config?.budget?.warn_threshold_pct ?? 80);

  function budgetSummary() {
    return budgetTracker.summary();
  }

  function trackBudget({ role, provider, result }) {
    const metrics = extractUsageMetrics(result);
    budgetTracker.record({ role, provider, ...metrics });

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
  const session = await createSession({
    task,
    config_snapshot: config,
    base_ref: baseRef,
    session_start_sha: baseRef,
    last_reviewer_feedback: null,
    repeated_issue_count: 0,
    sonar_retry_count: 0,
    reviewer_retry_count: 0,
    last_sonar_issue_signature: null,
    sonar_repeat_count: 0,
    last_reviewer_issue_signature: null,
    reviewer_repeat_count: 0
  });

  eventBase.sessionId = session.id;

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
  let sonarIssuesInitial = null;
  let sonarIssuesFinal = null;

  // --- Researcher (pre-planning) ---
  let researchContext = null;
  if (researcherEnabled) {
    logger.setContext({ iteration: 0, stage: "researcher" });
    emitProgress(
      emitter,
      makeEvent("researcher:start", { ...eventBase, stage: "researcher" }, {
        message: "Researcher investigating codebase"
      })
    );

    const researcher = new ResearcherRole({ config, logger, emitter });
    await researcher.init({ task });
    const researchOutput = await researcher.run({ task });
    trackBudget({
      role: "researcher",
      provider: config?.roles?.researcher?.provider || coderRole.provider,
      result: researchOutput
    });

    await addCheckpoint(session, { stage: "researcher", iteration: 0, ok: researchOutput.ok });

    emitProgress(
      emitter,
      makeEvent("researcher:end", { ...eventBase, stage: "researcher" }, {
        status: researchOutput.ok ? "ok" : "fail",
        message: researchOutput.ok ? "Research completed" : `Research failed: ${researchOutput.summary}`
      })
    );

    stageResults.researcher = { ok: researchOutput.ok, summary: researchOutput.summary || null };
    if (researchOutput.ok) {
      researchContext = researchOutput.result;
    }
  }

  // --- Planner ---
  let plannedTask = task;
  if (plannerEnabled) {
    logger.setContext({ iteration: 0, stage: "planner" });
    emitProgress(
      emitter,
      makeEvent("planner:start", { ...eventBase, stage: "planner" }, {
        message: `Planner (${plannerRole.provider}) running`,
        detail: { planner: plannerRole.provider }
      })
    );
    const planner = createAgent(plannerRole.provider, config, logger);
    const plannerPromptParts = [
      "Create an implementation plan for this task.",
      "Return concise numbered steps focused on execution order and risk.",
      "",
      task
    ];
    if (researchContext) {
      plannerPromptParts.push("", "## Research findings", JSON.stringify(researchContext, null, 2));
    }
    const plannerResult = await planner.runTask({ prompt: plannerPromptParts.join("\n"), role: "planner" });
    trackBudget({ role: "planner", provider: plannerRole.provider, result: plannerResult });
    if (!plannerResult.ok) {
      await markSessionStatus(session, "failed");
      const details = plannerResult.error || plannerResult.output || `exitCode=${plannerResult.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
          status: "fail",
          message: `Planner failed: ${details}`
        })
      );
      throw new Error(`Planner failed: ${details}`);
    }
    if (plannerResult.output?.trim()) {
      plannedTask = `${task}\n\nExecution plan:\n${plannerResult.output.trim()}`;
    }
    const parsedPlan = parsePlannerOutput(plannerResult.output);
    stageResults.planner = {
      ok: true,
      title: parsedPlan?.title || null,
      approach: parsedPlan?.approach || null,
      steps: parsedPlan?.steps || [],
      completedSteps: []
    };
    emitProgress(
      emitter,
      makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
        message: "Planner completed"
      })
    );
  }

  const gitCtx = await prepareGitAutomation({ config, task, logger, session });

  const projectDir = config.projectDir || process.cwd();
  const { rules: reviewRules } = await resolveReviewProfile({ mode: config.review_mode, projectDir });
  const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));

  for (let i = 1; i <= config.max_iterations; i += 1) {
    const elapsedMinutes = (Date.now() - startedAt) / 60000;
    if (elapsedMinutes > config.session.max_total_minutes) {
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
    logger.setContext({ iteration: i, stage: "coder" });
    emitProgress(
      emitter,
      makeEvent("coder:start", { ...eventBase, stage: "coder" }, {
        message: `Coder (${coderRole.provider}) running`,
        detail: { coder: coderRole.provider }
      })
    );

    const coderPrompt = buildCoderPrompt({
      task: plannedTask,
      reviewerFeedback: session.last_reviewer_feedback,
      sonarSummary: session.last_sonar_summary,
      coderRules,
      methodology: config.development?.methodology || "tdd"
    });
    const coderOnOutput = ({ stream, line }) => {
      emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "coder" }, {
        message: line,
        detail: { stream, agent: coderRole.provider }
      }));
    };
    const coderResult = await coder.runTask({ prompt: coderPrompt, onOutput: coderOnOutput, role: "coder" });
    trackBudget({ role: "coder", provider: coderRole.provider, result: coderResult });

    if (!coderResult.ok) {
      await markSessionStatus(session, "failed");
      const details = coderResult.error || coderResult.output || `exitCode=${coderResult.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
          status: "fail",
          message: `Coder failed: ${details}`
        })
      );
      throw new Error(`Coder failed: ${details}`);
    }

    await addCheckpoint(session, { stage: "coder", iteration: i, note: "Coder applied changes" });
    emitProgress(
      emitter,
      makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
        message: "Coder completed"
      })
    );

    if (refactorerEnabled) {
      logger.setContext({ iteration: i, stage: "refactorer" });
      emitProgress(
        emitter,
        makeEvent("refactorer:start", { ...eventBase, stage: "refactorer" }, {
          message: `Refactorer (${refactorerRole.provider}) running`,
          detail: { refactorer: refactorerRole.provider }
        })
      );
      const refactorer = createAgent(refactorerRole.provider, config, logger);
      const refactorPrompt = [
        `Task context:\n${plannedTask}`,
        "",
        "Refactor the current changes for clarity and maintainability without changing behavior.",
        "Do not expand scope and keep tests green."
      ].join("\n");
      const refactorerOnOutput = ({ stream, line }) => {
        emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "refactorer" }, {
          message: line,
          detail: { stream, agent: refactorerRole.provider }
        }));
      };
      const refactorResult = await refactorer.runTask({
        prompt: refactorPrompt,
        onOutput: refactorerOnOutput,
        role: "refactorer"
      });
      trackBudget({ role: "refactorer", provider: refactorerRole.provider, result: refactorResult });
      if (!refactorResult.ok) {
        await markSessionStatus(session, "failed");
        const details = refactorResult.error || refactorResult.output || `exitCode=${refactorResult.exitCode ?? "unknown"}`;
        emitProgress(
          emitter,
          makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
            status: "fail",
            message: `Refactorer failed: ${details}`
          })
        );
        throw new Error(`Refactorer failed: ${details}`);
      }
      await addCheckpoint(session, { stage: "refactorer", iteration: i, note: "Refactorer applied cleanups" });
      emitProgress(
        emitter,
        makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
          message: "Refactorer completed"
        })
      );
    }

    // --- TDD Policy ---
    logger.setContext({ iteration: i, stage: "tdd" });
    const tddDiff = await generateDiff({ baseRef: session.session_start_sha });
    const tddEval = evaluateTddPolicy(tddDiff, config.development);
    await addCheckpoint(session, {
      stage: "tdd-policy",
      iteration: i,
      ok: tddEval.ok,
      reason: tddEval.reason,
      source_files: tddEval.sourceFiles?.length || 0,
      test_files: tddEval.testFiles?.length || 0
    });

    emitProgress(
      emitter,
      makeEvent("tdd:result", { ...eventBase, stage: "tdd" }, {
        status: tddEval.ok ? "ok" : "fail",
        message: tddEval.ok ? "TDD policy passed" : `TDD policy failed: ${tddEval.reason}`,
        detail: {
          ok: tddEval.ok,
          reason: tddEval.reason,
          sourceFiles: tddEval.sourceFiles?.length || 0,
          testFiles: tddEval.testFiles?.length || 0
        }
      })
    );

    if (!tddEval.ok) {
      session.last_reviewer_feedback = tddEval.message;
      session.repeated_issue_count += 1;
      await saveSession(session);
      if (session.repeated_issue_count >= config.session.fail_fast_repeats) {
        const question = `TDD policy has failed ${session.repeated_issue_count} times. The coder is not creating tests. How should we proceed? Issue: ${tddEval.reason}`;
        if (askQuestion) {
          const answer = await askQuestion(question, { iteration: i, stage: "tdd" });
          if (answer) {
            session.last_reviewer_feedback += `\nUser guidance: ${answer}`;
            session.repeated_issue_count = 0;
            await saveSession(session);
            continue;
          }
        }
        await pauseSession(session, {
          question,
          context: {
            iteration: i,
            stage: "tdd",
            lastFeedback: tddEval.message,
            repeatedCount: session.repeated_issue_count
          }
        });
        emitProgress(
          emitter,
          makeEvent("question", { ...eventBase, stage: "tdd" }, {
            status: "paused",
            message: question,
            detail: { question, sessionId: session.id }
          })
        );
        return { paused: true, sessionId: session.id, question, context: "tdd_fail_fast" };
      }
      continue;
    }

    // --- SonarQube (via SonarRole) ---
    if (config.sonarqube.enabled) {
      logger.setContext({ iteration: i, stage: "sonar" });
      emitProgress(
        emitter,
        makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, {
          message: "SonarQube scanning"
        })
      );

      const sonarRole = new SonarRole({ config, logger, emitter });
      await sonarRole.init({ iteration: i });
      const sonarOutput = await sonarRole.run();
      trackBudget({ role: "sonar", provider: "sonar", result: sonarOutput });
      const sonarResult = sonarOutput.result;

      if (!sonarResult.gateStatus && sonarResult.error) {
        await markSessionStatus(session, "failed");
        emitProgress(
          emitter,
          makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
            status: "fail",
            message: `Sonar scan failed: ${sonarResult.error}`
          })
        );
        throw new Error(`Sonar scan failed: ${sonarResult.error}`);
      }

      session.last_sonar_summary = sonarOutput.summary;
      if (typeof sonarResult.openIssuesTotal === "number") {
        if (sonarIssuesInitial === null) {
          sonarIssuesInitial = sonarResult.openIssuesTotal;
        }
        sonarIssuesFinal = sonarResult.openIssuesTotal;
      }
      await addCheckpoint(session, {
        stage: "sonar",
        iteration: i,
        project_key: sonarResult.projectKey,
        quality_gate: sonarResult.gateStatus,
        open_issues: sonarResult.openIssuesTotal
      });

      emitProgress(
        emitter,
        makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
          status: sonarResult.blocking ? "fail" : "ok",
          message: `Quality gate: ${sonarResult.gateStatus}`,
          detail: { projectKey: sonarResult.projectKey, gateStatus: sonarResult.gateStatus, openIssues: sonarResult.openIssuesTotal }
        })
      );

      if (sonarResult.blocking) {
        repeatDetector.addIteration(sonarResult.issues, []);
        const repeatState = repeatDetector.isStalled();
        if (repeatState.stalled) {
          const repeatCounts = repeatDetector.getRepeatCounts();
          const message = `No progress: SonarQube issues repeated ${repeatCounts.sonar} times.`;
          logger.warn(message);
          await markSessionStatus(session, "stalled");
          emitProgress(
            emitter,
            makeEvent("session:end", { ...eventBase, stage: "sonar" }, {
              status: "stalled",
              message,
              detail: { reason: repeatState.reason, repeats: repeatCounts.sonar, budget: budgetSummary() }
            })
          );
          return { approved: false, sessionId: session.id, reason: "stalled" };
        }

        session.last_reviewer_feedback = `Sonar gate blocking (${sonarResult.gateStatus}). Resolve critical findings first.`;
        session.sonar_retry_count = (session.sonar_retry_count || 0) + 1;
        await saveSession(session);
        const maxSonarRetries = config.session.max_sonar_retries ?? config.session.fail_fast_repeats;
        if (session.sonar_retry_count >= maxSonarRetries) {
          emitProgress(
            emitter,
            makeEvent("solomon:escalate", { ...eventBase, stage: "sonar" }, {
              message: `Sonar sub-loop limit reached (${session.sonar_retry_count}/${maxSonarRetries})`,
              detail: { subloop: "sonar", retryCount: session.sonar_retry_count, limit: maxSonarRetries, gateStatus: sonarResult.gateStatus }
            })
          );

          const solomonResult = await invokeSolomon({
            config, logger, emitter, eventBase, stage: "sonar", askQuestion, session, iteration: i,
            conflict: {
              stage: "sonar",
              task,
              iterationCount: session.sonar_retry_count,
              maxIterations: maxSonarRetries,
              history: [{ agent: "sonar", feedback: session.last_sonar_summary }]
            }
          });

          if (solomonResult.action === "pause") {
            return { paused: true, sessionId: session.id, question: solomonResult.question, context: "sonar_fail_fast" };
          }
          if (solomonResult.action === "continue") {
            if (solomonResult.humanGuidance) {
              session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
            }
            session.sonar_retry_count = 0;
            await saveSession(session);
            continue;
          }
          if (solomonResult.action === "subtask") {
            return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "sonar_subtask" };
          }
        }
        continue;
      }

      // Sonar passed — reset retry counter
      session.sonar_retry_count = 0;
      const issuesInitial = sonarIssuesInitial ?? sonarResult.openIssuesTotal ?? 0;
      const issuesFinal = sonarIssuesFinal ?? sonarResult.openIssuesTotal ?? 0;
      stageResults.sonar = {
        gateStatus: sonarResult.gateStatus,
        openIssues: sonarResult.openIssuesTotal,
        issuesInitial,
        issuesFinal,
        issuesResolved: Math.max(issuesInitial - issuesFinal, 0)
      };
    }

    // --- Reviewer ---
    logger.setContext({ iteration: i, stage: "reviewer" });
    emitProgress(
      emitter,
      makeEvent("reviewer:start", { ...eventBase, stage: "reviewer" }, {
        message: `Reviewer (${reviewerRole.provider}) running`,
        detail: { reviewer: reviewerRole.provider }
      })
    );

    const diff = await generateDiff({ baseRef: session.session_start_sha });
    const reviewerPrompt = buildReviewerPrompt({
      task,
      diff,
      reviewRules,
      mode: config.review_mode
    });
    const reviewerOnOutput = ({ stream, line }) => {
      emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "reviewer" }, {
        message: line,
        detail: { stream, agent: reviewerRole.provider }
      }));
    };
    const reviewerExec = await runReviewerWithFallback({
      reviewerName: reviewerRole.provider,
      config,
      logger,
      prompt: reviewerPrompt,
      session,
      iteration: i,
      onOutput: reviewerOnOutput,
      onAttemptResult: ({ reviewer, result }) => {
        trackBudget({ role: "reviewer", provider: reviewer, result });
      }
    });

    if (!reviewerExec.result || !reviewerExec.result.ok) {
      await markSessionStatus(session, "failed");
      const lastAttempt = reviewerExec.attempts.at(-1);
      const details =
        lastAttempt?.result?.error ||
        lastAttempt?.result?.output ||
        `reviewer=${lastAttempt?.reviewer || "unknown"} exitCode=${lastAttempt?.result?.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
          status: "fail",
          message: `Reviewer failed: ${details}`
        })
      );
      throw new Error(`Reviewer failed: ${details}`);
    }

    let review;
    try {
      const parsed = parseJsonOutput(reviewerExec.result.output);
      if (!parsed) {
        throw new Error("Reviewer output is not valid JSON");
      }
      review = validateReviewResult(parsed);
    } catch (parseErr) {
      logger.warn(`Reviewer output parse/validation failed: ${parseErr.message}`);
      review = {
        approved: false,
        blocking_issues: [{
          id: "PARSE_ERROR",
          severity: "high",
          description: `Reviewer output could not be parsed: ${parseErr.message}`
        }],
        non_blocking_suggestions: [],
        summary: `Parse error: ${parseErr.message}`,
        confidence: 0
      };
    }
    await addCheckpoint(session, {
      stage: "reviewer",
      iteration: i,
      approved: review.approved,
      blocking_issues: review.blocking_issues.length
    });

    emitProgress(
      emitter,
      makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
        status: review.approved ? "ok" : "fail",
        message: review.approved ? "Review approved" : `Review rejected (${review.blocking_issues.length} blocking)`,
        detail: {
          approved: review.approved,
          blockingCount: review.blocking_issues.length,
          issues: review.blocking_issues.map(
            (x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`
          )
        }
      })
    );

    if (!review.approved) {
      repeatDetector.addIteration([], review.blocking_issues);
      const repeatState = repeatDetector.isStalled();
      if (repeatState.stalled) {
        const repeatCounts = repeatDetector.getRepeatCounts();
        const message = `Manual intervention required: reviewer issues repeated ${repeatCounts.reviewer} times.`;
        logger.warn(message);
        await markSessionStatus(session, "stalled");
        emitProgress(
          emitter,
          makeEvent("session:end", { ...eventBase, stage: "reviewer" }, {
            status: "stalled",
            message,
            detail: { reason: repeatState.reason, repeats: repeatCounts.reviewer, budget: budgetSummary() }
          })
        );
        return { approved: false, sessionId: session.id, reason: "stalled" };
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

    if (review.approved) {
      session.reviewer_retry_count = 0;

      // --- Post-loop stages: Tester → Security ---
      const postLoopDiff = await generateDiff({ baseRef: session.session_start_sha });

      // --- Tester ---
      if (testerEnabled) {
        logger.setContext({ iteration: i, stage: "tester" });
        emitProgress(
          emitter,
          makeEvent("tester:start", { ...eventBase, stage: "tester" }, {
            message: "Tester evaluating test quality"
          })
        );

        const tester = new TesterRole({ config, logger, emitter });
        await tester.init({ task, iteration: i });
        const testerOutput = await tester.run({ task, diff: postLoopDiff });
        trackBudget({
          role: "tester",
          provider: config?.roles?.tester?.provider || coderRole.provider,
          result: testerOutput
        });

        await addCheckpoint(session, { stage: "tester", iteration: i, ok: testerOutput.ok });

        emitProgress(
          emitter,
          makeEvent("tester:end", { ...eventBase, stage: "tester" }, {
            status: testerOutput.ok ? "ok" : "fail",
            message: testerOutput.ok ? "Tester passed" : `Tester: ${testerOutput.summary}`
          })
        );

        if (!testerOutput.ok) {
          const maxTesterRetries = config.session?.max_tester_retries ?? 1;
          session.tester_retry_count = (session.tester_retry_count || 0) + 1;
          await saveSession(session);

          if (session.tester_retry_count >= maxTesterRetries) {
            const solomonResult = await invokeSolomon({
              config, logger, emitter, eventBase, stage: "tester", askQuestion, session, iteration: i,
              conflict: {
                stage: "tester",
                task,
                diff: postLoopDiff,
                iterationCount: session.tester_retry_count,
                maxIterations: maxTesterRetries,
                history: [{ agent: "tester", feedback: testerOutput.summary }]
              }
            });

            if (solomonResult.action === "pause") {
              return { paused: true, sessionId: session.id, question: solomonResult.question, context: "tester_fail_fast" };
            }
            if (solomonResult.action === "subtask") {
              return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "tester_subtask" };
            }
            // continue = Solomon approved, proceed to next stage
          } else {
            session.last_reviewer_feedback = `Tester feedback: ${testerOutput.summary}`;
            await saveSession(session);
            continue;
          }
        } else {
          session.tester_retry_count = 0;
          stageResults.tester = { ok: true, summary: testerOutput.summary || "All tests passed" };
        }
      }

      // --- Security ---
      if (securityEnabled) {
        logger.setContext({ iteration: i, stage: "security" });
        emitProgress(
          emitter,
          makeEvent("security:start", { ...eventBase, stage: "security" }, {
            message: "Security auditing code"
          })
        );

        const security = new SecurityRole({ config, logger, emitter });
        await security.init({ task, iteration: i });
        const securityOutput = await security.run({ task, diff: postLoopDiff });
        trackBudget({
          role: "security",
          provider: config?.roles?.security?.provider || coderRole.provider,
          result: securityOutput
        });

        await addCheckpoint(session, { stage: "security", iteration: i, ok: securityOutput.ok });

        emitProgress(
          emitter,
          makeEvent("security:end", { ...eventBase, stage: "security" }, {
            status: securityOutput.ok ? "ok" : "fail",
            message: securityOutput.ok ? "Security audit passed" : `Security: ${securityOutput.summary}`
          })
        );

        if (!securityOutput.ok) {
          const maxSecurityRetries = config.session?.max_security_retries ?? 1;
          session.security_retry_count = (session.security_retry_count || 0) + 1;
          await saveSession(session);

          if (session.security_retry_count >= maxSecurityRetries) {
            const solomonResult = await invokeSolomon({
              config, logger, emitter, eventBase, stage: "security", askQuestion, session, iteration: i,
              conflict: {
                stage: "security",
                task,
                diff: postLoopDiff,
                iterationCount: session.security_retry_count,
                maxIterations: maxSecurityRetries,
                history: [{ agent: "security", feedback: securityOutput.summary }]
              }
            });

            if (solomonResult.action === "pause") {
              return { paused: true, sessionId: session.id, question: solomonResult.question, context: "security_fail_fast" };
            }
            if (solomonResult.action === "subtask") {
              return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "security_subtask" };
            }
            // continue = Solomon approved, proceed
          } else {
            session.last_reviewer_feedback = `Security feedback: ${securityOutput.summary}`;
            await saveSession(session);
            continue;
          }
        } else {
          session.security_retry_count = 0;
          stageResults.security = { ok: true, summary: securityOutput.summary || "No vulnerabilities found" };
        }
      }

      // --- All post-loop checks passed → finalize ---
      const gitResult = await finalizeGitAutomation({ config, gitCtx, task, logger, session });
      if (stageResults.planner?.ok) {
        stageResults.planner.completedSteps = [...(stageResults.planner.steps || [])];
      }
      await markSessionStatus(session, "approved");
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, stage: "done" }, {
          message: "Session approved",
          detail: { approved: true, iterations: i, stages: stageResults, git: gitResult, budget: budgetSummary() }
        })
      );
      return { approved: true, sessionId: session.id, review, git: gitResult };
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

  if (session.status !== "running") {
    logger.info(`Session ${sessionId} has status ${session.status}`);
    return session;
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
