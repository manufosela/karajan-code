import { createAgent } from "../agents/index.js";
import {
  loadSession,
  markSessionStatus,
  pauseSession,
  resumeSessionWithAnswer,
  saveSession,
  addCheckpoint
} from "../session/store.js";
import { generateDiff } from "../review/diff-generator.js";
import { resolveRole } from "../config.js";
import { resolveReviewProfile } from "../review/profiles.js";
import { msg, getLang } from "../utils/messages.js";
import { RepeatDetector, getRepeatThreshold } from "../repeat-detector.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import {
  prepareGitAutomation,
  finalizeGitAutomation
} from "../git/automation.js";
import { scanDiff } from "../guards/output-guard.js";
import { scanPerfDiff } from "../guards/perf-guard.js";
import { classifyIntent } from "../guards/intent-guard.js";
import { CoderRole } from "../roles/coder-role.js";
import { invokeSolomon } from "./solomon-escalation.js";
import { PipelineContext } from "./pipeline-context.js";
import { runTriageStage, runResearcherStage, runArchitectStage, runPlannerStage, runDiscoverStage, runHuReviewerStage } from "./pre-loop-stages.js";
import { runDomainCuratorStage } from "./stages/domain-curator-stage.js";
import { persistInlineDomain } from "../domains/domain-loader.js";
import { runCoderStage, runRefactorerStage, runTddCheckStage, runSonarStage, runSonarCloudStage, runReviewerStage } from "./iteration-stages.js";
import { runTesterStage, runSecurityStage, runImpeccableStage, runFinalAuditStage } from "./post-loop-stages.js";
import { needsSubPipeline, runHuSubPipeline } from "./hu-sub-pipeline.js";
import { waitForCooldown, MAX_STANDBY_RETRIES } from "./standby.js";
import { detectTestFramework } from "../utils/project-detect.js";
import { runPreflightChecks } from "./preflight-checks.js";
import { detectRtk } from "../utils/rtk-detect.js";
import { createRtkRunner, RtkSavingsTracker } from "../utils/rtk-wrapper.js";
import { setRunner as setDiffRunner, setProjectDir as setDiffProjectDir } from "../review/diff-generator.js";
import { setRunner as setGitRunner } from "../utils/git.js";
import { detectNeededSkills, autoInstallSkills, cleanupAutoInstalledSkills } from "../skills/skill-detector.js";
import { isOpenSkillsAvailable } from "../skills/openskills-client.js";
import { refineSkillsSemantically, resolveSkillsMode } from "../skills/semantic-detector.js";
import { refreshIfStale as refreshAddyosmaniCatalog, listAvailableSlugs as listAddyosmaniSlugs } from "../skills/addyosmani-catalog.js";
import { resolveAddyosmaniSlugs } from "../skills/addyosmani-role-map.js";

// Extracted modules
import {
  loadProductContext,
  resolvePipelineFlags, handleDryRun, createBudgetManager,
  initializeSession, applyTriageOverrides, applyAutoSimplify,
  applyFlagOverrides, resolvePipelinePolicies, autoInit,
  updateGitignoreForStack
} from "./config-init.js";
import { resolveTestHarness } from "../config/test-harness.js";
import {
  tryCiComment, handleCiEarlyPrOrPush, handleCiReviewDispatch,
  formatBlockingIssues
} from "./ci-integration.js";
import {
  handleCheckpoint, checkSessionTimeout, checkBudgetExceeded,
  takeCheckpointSnapshot
} from "./flow-control.js";
import {
  createJournalDir, writePreLoopJournal, writeIterationsJournal,
  writeDecisionsJournal, writeTreeJournal, writeSummaryJournal,
  formatIteration, formatDecision, buildPlanSummary
} from "./session-journal.js";

// Drivers extracted from this god-module in TSK-0335 (Oleada 3 of the v2.7.4
// audit refactor). Each driver covers one phase of the pipeline; flow-runner
// keeps only the top-level runFlow/resumeFlow orchestration.
import {
  handleStandbyResult,
  handleSolomonCheck,
  handleReviewerRetryAndSolomon
} from "./drivers/error-recovery.js";
import {
  handlePostLoopStages,
  finalizeApprovedSession,
  handleMaxIterationsReached,
  tryAutoStartBoard,
  writeHistoryRecord
} from "./drivers/post-loop.js";

// Public re-exports (loadProductContext, shouldAutoContinueCheckpoint,
// parseCheckpointAnswer) live in src/orchestrator.js (the barrel).


// PG card "In Progress" logic moved to src/planning-game/pipeline-adapter.js → initPgAdapter()

async function runPlanningPhases({ config, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx }) {
  let researchContext = null;
  let plannedTask = task;

  // Brain: track compression across pre-loop roles
  const brainCompress = brainCtx?.enabled
    ? (await import("./brain-coordinator.js")).processRoleOutput
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






// PG card "To Validate" logic moved to src/planning-game/pipeline-adapter.js → markPgCardToValidate()


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

  // --- Brain decisor (opt-in, intent-driven routing) ---
  //
  // When enabled, translates triage output + task text + CLI overrides into a
  // structured Decision and applies it as pipelineFlags overrides. The rest
  // of the orchestrator continues to branch on pipelineFlags as before — the
  // Brain is a router that adjusts WHICH roles run, not HOW they run.
  //
  // Flag precedence:
  //   1. flags.brain === "off"    → forced off
  //   2. flags.brain === "on"     → forced on
  //   3. config.brain.decisor.enabled (if set)
  //   4. config.testHarness.defaultBrainDecisor (test harness = false)
  //   5. true in production
  const brainDefault = config?.testHarness?.defaultBrainDecisor ?? true;
  let brainDecisorEnabled = config?.brain?.decisor?.enabled ?? brainDefault;
  if (flags?.brain === "off") brainDecisorEnabled = false;
  if (flags?.brain === "on") brainDecisorEnabled = true;
  if (brainDecisorEnabled) {
    try {
      const { buildDecision, applyDecisionToFlags } = await import("../brain/decisor.js");
      const { createTracker, recordDecision, checkLimits } = await import("../brain/decision-tracker.js");
      const tracker = createTracker(session, { max: config?.brain?.decisor?.maxDecisions });
      const limitStatus = checkLimits(tracker);
      if (limitStatus.status === "ok") {
        let decision = buildDecision({
          triage: triageResult.stageResult,
          task,
          config,
          overrides: {
            // Commander variadic --force-role a b → flags.forceRole = ["a","b"].
            // Back-compat: accept both singular (commander) and plural (legacy / API).
            forceRoles: flags?.forceRole || flags?.forceRoles || [],
            skipRoles: flags?.skipRole || flags?.skipRoles || [],
          },
        });
        // If the decision is low-confidence or ambiguous, consult Solomon
        // for a refined routing suggestion. Solomon's ruling is advisory —
        // if it fails or returns nothing useful, the baseline decision stands.
        if (decision.consultSolomon) {
          try {
            const { consultSolomonForRouting } = await import("../brain/solomon-consult.js");
            decision = await consultSolomonForRouting({
              decision, triage: triageResult.stageResult, task, config, logger,
              emitter, eventBase, session,
            });
          } catch (err) {
            logger.warn(`Brain → Solomon consult failed (non-blocking): ${err.message}`);
          }
        }
        const newFlags = applyDecisionToFlags(decision, pipelineFlags);
        Object.assign(pipelineFlags, newFlags);
        recordDecision(tracker, decision, {
          taskType: triageResult.stageResult?.taskType,
          level: triageResult.stageResult?.level,
        });
        emitProgress(emitter, makeEvent("brain:decision", { ...eventBase, stage: "brain" }, {
          status: "ok",
          message: `Brain routing: ${decision.rolesOn.length} role(s) active — ${decision.rationale}`,
          detail: {
            rolesOn: decision.rolesOn,
            rolesOff: decision.rolesOff,
            confidence: decision.confidence,
            consultSolomon: decision.consultSolomon,
            appliedOverrides: decision.appliedOverrides,
          },
        }));
      } else {
        logger.warn(`Brain decisor skipped: ${limitStatus.detail}`);
        emitProgress(emitter, makeEvent("brain:decision", { ...eventBase, stage: "brain" }, {
          status: "warn",
          message: `Brain decisor skipped: ${limitStatus.status}`,
          detail: limitStatus,
        }));
      }
    } catch (err) {
      logger.warn(`Brain decisor failed (non-blocking): ${err.message}`);
    }
  }

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
      const { buildHuStoriesFromPgCard } = await import("../planning-game/pipeline-adapter.js");
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

  const { handlePgDecomposition } = await import("../planning-game/pipeline-adapter.js");
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

  // Deprecation warnings recorded at config load time. Done here, after
  // policies are resolved, so the message lands in context: if the user's
  // legacy `sonarqube.enabled: false` is being ignored, this is the right
  // moment for them to see it.
  emitConfigDeprecations(updatedConfig, logger, emitter, eventBase);

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
      const { loadPlan, savePlan: savePlanToDisk } = await import("../plan/plan-store.js");
      const { isPlanV2 } = await import("../plan/plan-schema.js");
      const { planToHuBatch, syncResultsToPlan } = await import("../plan/plan-executor.js");
      const projectDir = updatedConfig.projectDir || process.cwd();
      const loadedPlan = await loadPlan(projectDir, flags.plan);
      if (loadedPlan) {
        logger.info(`Loaded persisted plan: ${flags.plan} (v${loadedPlan.version || 1})`);
        emitProgress(emitter, makeEvent("plan:loaded", { ...eventBase, stage: "plan" }, {
          message: `Plan loaded: ${flags.plan}`,
          detail: { planId: flags.plan, task: loadedPlan.task, version: loadedPlan.version, huCount: loadedPlan.hus?.length || 0 }
        }));
        stageResults.researcher = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
        stageResults.architect = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
        stageResults.planner = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };

        // v2 plan with HUs → inject as huReviewer so sub-pipeline picks them up
        if (isPlanV2(loadedPlan) && loadedPlan.hus?.length > 0) {
          const huBatch = planToHuBatch(loadedPlan);
          if (huBatch.ok) {
            stageResults.huReviewer = huBatch;
            // Store plan reference so we can sync results back after execution
            session._planRef = { planId: loadedPlan.planId, projectDir };
            session._syncResultsToPlan = async (subResult) => {
              syncResultsToPlan(loadedPlan, subResult);
              await savePlanToDisk(projectDir, loadedPlan);
            };
            logger.info(`Plan ${flags.plan}: ${huBatch.certified} HUs ready for execution`);
            emitProgress(emitter, makeEvent("plan:hus-loaded", { ...eventBase, stage: "plan" }, {
              message: `${huBatch.certified} HUs loaded from plan`,
              detail: { planId: flags.plan, total: huBatch.total, certified: huBatch.certified }
            }));
            // Mark plan as running
            loadedPlan.status = "running";
            await savePlanToDisk(projectDir, loadedPlan);
          }
        }

        // Inject contexts
        const ctx = loadedPlan.context || {};
        session.research_context = ctx.researchContext || loadedPlan.researchContext || null;
        session.architect_context = ctx.architectContext || loadedPlan.architectContext || null;
        session.loaded_plan = loadedPlan.approach || loadedPlan.plan || null;
        await saveSession(session);

        // Build planned task from plan (for non-HU or fallback path)
        let plannedTask = task;
        const plan = loadedPlan.plan || (loadedPlan.approach ? { approach: loadedPlan.approach } : null);
        if (plan && typeof plan === "object" && plan.steps) {
          const stepList = plan.steps.map((s, idx) => `${idx + 1}. ${s.description || s}`).join("\n");
          plannedTask = `${task}\n\n## Implementation Plan\n${plan.approach || ""}\n\n## Steps\n${stepList}`;
        } else if (typeof plan === "string") {
          plannedTask = `${task}\n\n## Implementation Plan\n${plan}`;
        } else if (loadedPlan.approach) {
          plannedTask = `${task}\n\n## Approach\n${loadedPlan.approach}`;
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

  // --- Auto-HU: when triage recommended decomposition and no manual huFile, generate HU batch ---
  await maybeGenerateAutoHuBatch({
    flags, stageResults, task, plannedTask, logger, emitter, eventBase, projectDir, session
  });

  // --- Auto-install skills based on task + planner output + project detection ---
  // Runs AFTER triage and planner so that the planned task text (which includes
  // planner output like implementation steps) is available for keyword detection.
  // This ensures greenfield projects with no package.json still get correct skills.
  //
  // Detection runs UNCONDITIONALLY — even when the openskills CLI is missing —
  // so the session report can recommend which skills would have been used. The
  // actual install is skipped inside autoInstallSkills when unavailable.
  const skillProjectDir = updatedConfig.projectDir || process.cwd();
  try {
    const skillsMode = resolveSkillsMode(updatedConfig, flags);
    if (skillsMode === "none") {
      // User explicitly opted out. Skip detection entirely.
      return { plannedTask, updatedConfig };
    }

    // FIRST source: addyosmani/agent-skills (process skills per role).
    // This runs BEFORE OpenSkills detection because process skills are the
    // canonical workflows (TDD, code-review, security, performance...) that
    // should shape every role's prompt; stack skills come second.
    await ensureAddyosmaniSkills({
      task: plannedTask,
      config: updatedConfig,
      logger,
      session,
      emitter,
      eventBase,
    });

    let neededSkills = skillsMode === "semantic"
      ? []
      : await detectNeededSkills(plannedTask, skillProjectDir);
    // Semantic mode augments regex detection with a classifier call.
    // "auto" = regex always + semantic when budget allows (v1: always when mode=auto and classifier reachable).
    if (skillsMode === "auto" || skillsMode === "semantic") {
      const extra = await refineSkillsSemantically({
        task: plannedTask,
        alreadyDetected: neededSkills,
        config: updatedConfig,
        logger,
      });
      if (extra.length > 0) {
        logger.info(`Semantic skill detection added: ${extra.join(", ")}`);
        neededSkills = Array.from(new Set([...neededSkills, ...extra]));
      }
    }
    if (neededSkills.length > 0) {
      const skillResult = await autoInstallSkills(neededSkills, skillProjectDir);
      if (skillResult.installed.length > 0) {
        session.autoInstalledSkills = skillResult.installed;
      }
      if (skillResult.osAvailable === false && skillResult.wouldHaveUsed.length > 0) {
        session.skillsRecommended = skillResult.wouldHaveUsed;
        logger.warn(`OpenSkills CLI not available — would have used: ${skillResult.wouldHaveUsed.join(", ")}. Install openskills globally to auto-inject them next time.`);
        emitProgress(emitter, makeEvent("skills:unavailable", { ...eventBase, stage: "skills" }, {
          message: `OpenSkills CLI not available — would have used: ${skillResult.wouldHaveUsed.join(", ")}`,
          detail: {
            wouldHaveUsed: skillResult.wouldHaveUsed,
            hint: "Install openskills globally: npm install -g openskills",
          },
        }));
      }
      emitProgress(emitter, makeEvent("skills:auto-install", { ...eventBase, stage: "skills" }, {
        message: skillResult.installed.length > 0
          ? `Auto-installed ${skillResult.installed.length} skill(s): ${skillResult.installed.join(", ")}`
          : `Skills detected (${neededSkills.join(", ")}) — all already installed or unavailable`,
        detail: skillResult,
      }));
    }
  } catch (err) {
    logger.warn(`Skill auto-install failed (non-blocking): ${err.message}`);
  }

  return { plannedTask, updatedConfig };
}

/**
 * Ensure the addyosmani/agent-skills catalog is present and fresh, then
 * resolve which upstream slugs are relevant for the current task. The
 * resolved slugs are stored on `session.addyosmaniSkills` so downstream
 * prompt builders can inject them ahead of OpenSkills-detected stack skills.
 *
 * Config surface (all optional, sensible defaults):
 *   skills:
 *     sources: ["addyosmani", "openskills", "local"]  # default
 *     addyosmani:
 *       enabled: true
 *       refreshDays: 7
 *       repoUrl: "https://github.com/addyosmani/agent-skills.git"
 *
 * Setting skills.addyosmani.enabled = false, or removing "addyosmani" from
 * skills.sources, disables this step entirely (reverts to OpenSkills-only).
 */
/**
 * Print one-time deprecation warnings for config keys / CLI flags that
 * Karajan no longer honours. Called once per run, after policy resolution
 * so the message lands in context (the user sees what's being ignored
 * RIGHT before the preflight that would have been affected).
 *
 * Currently surfaces:
 *   - `sonarqube.enabled` set in user config → ignored since v2.7.4
 *   - `--no-sonar` CLI flag → ignored since v2.7.4
 */
function emitConfigDeprecations(config, logger, emitter, eventBase) {
  const dep = config?._deprecated;
  if (!dep) return;

  if (dep.sonarqubeEnabledKey) {
    const m =
      "DEPRECATED: `sonarqube.enabled` in kj.config.yml is ignored since v2.7.4. " +
      "Sonar is intrinsic to Karajan for code tasks (sw/refactor/add-tests) and " +
      "skipped for non-code tasks (audit/doc/infra/analysis/no-code) by policy. " +
      "Remove the key from your config to silence this warning.";
    logger.warn(m);
    emitProgress(emitter, makeEvent("config:deprecated", { ...eventBase, stage: "config" }, {
      message: m,
      detail: { key: "sonarqube.enabled", since: "v2.7.4" },
    }));
  }

  if (dep.noSonarFlag) {
    const m =
      "DEPRECATED: `--no-sonar` flag is ignored since v2.7.4. Sonar runs for code " +
      "tasks by policy. To skip Sonar on a one-off run, use a non-code task type " +
      "(e.g. `--task-type doc`) or rely on Solomon's runtime override.";
    logger.warn(m);
    emitProgress(emitter, makeEvent("config:deprecated", { ...eventBase, stage: "config" }, {
      message: m,
      detail: { flag: "--no-sonar", since: "v2.7.4" },
    }));
  }
}

async function ensureAddyosmaniSkills({ task, config, logger, session, emitter, eventBase }) {
  const skillsConfig = config?.skills || {};
  const sources = Array.isArray(skillsConfig.sources) ? skillsConfig.sources : ["addyosmani", "openskills", "local"];
  const addyConfig = skillsConfig.addyosmani || {};
  // Test harness override: config.testHarness.defaultAddyosmaniEnabled=false
  // prevents orchestrator tests from spawning git. Tests that need the real
  // catalog opt in by setting config.skills.addyosmani.enabled = true.
  // Post-v2.7.5 no longer reads globalThis directly — config.testHarness is
  // populated by the loader from the global or the production default.
  const harnessDefault = config?.testHarness?.defaultAddyosmaniEnabled;
  const enabledFromConfig = addyConfig.enabled === true
    || (addyConfig.enabled !== false && harnessDefault !== false);
  const enabled = enabledFromConfig && sources.includes("addyosmani");
  if (!enabled) return;

  const refreshDays = Number.isFinite(addyConfig.refreshDays) ? addyConfig.refreshDays : 7;
  const refreshMs = Math.max(0, refreshDays) * 24 * 60 * 60 * 1000;

  try {
    const refreshResult = await refreshAddyosmaniCatalog({
      refreshMs,
      repoUrl: addyConfig.repoUrl,
      logger,
    });

    if (!refreshResult.ok) {
      session.addyosmaniSkills = { available: false, reason: refreshResult.error || "refresh failed" };
      emitProgress(emitter, makeEvent("skills:addyosmani-unavailable", { ...eventBase, stage: "skills" }, {
        message: `addyosmani/agent-skills catalog unavailable: ${refreshResult.error || refreshResult.action}`,
        detail: { action: refreshResult.action, hint: "Install git to enable process skills from addyosmani/agent-skills" },
      }));
      return;
    }

    const available = new Set(await listAddyosmaniSlugs());
    const resolved = resolveAddyosmaniSlugs({ role: null, task }); // role resolution happens per-stage later
    const valid = resolved.filter((slug) => available.has(slug));

    session.addyosmaniSkills = {
      available: true,
      action: refreshResult.action,
      resolvedSlugs: valid,
      allAvailable: Array.from(available),
    };

    emitProgress(emitter, makeEvent("skills:addyosmani-ready", { ...eventBase, stage: "skills" }, {
      message: `addyosmani/agent-skills ${refreshResult.action} — ${available.size} slug(s) available, ${valid.length} relevant to task`,
      detail: {
        action: refreshResult.action,
        relevantSlugs: valid,
        availableCount: available.size,
      },
    }));
  } catch (err) {
    logger.warn(`addyosmani catalog step failed (non-blocking): ${err.message}`);
    session.addyosmaniSkills = { available: false, reason: err.message };
  }
}

/**
 * Auto-generate HU batch from triage decomposition when no manual huFile is present.
 * Runs after researcher/architect/planner so that context is available for better HUs.
 * Sets stageResults.huReviewer so needsSubPipeline picks it up later.
 */
async function maybeGenerateAutoHuBatch({ flags, stageResults, task, plannedTask, logger, emitter, eventBase, projectDir, session }) {
  // Skip if user passed a manual hu-file
  if (flags?.huFile) return;
  // Skip if hu-reviewer already produced a batch (manual enable + PG stories)
  if (stageResults.huReviewer) return;
  // Need triage decomposition recommendation
  const shouldDecompose = stageResults.triage?.shouldDecompose;
  const subtasks = stageResults.triage?.subtasks;
  if (!shouldDecompose || !Array.isArray(subtasks) || subtasks.length < 2) return;

  const { generateHuBatch } = await import("../hu/auto-generator.js");

  // Detect if project is new: empty dir or only .git/.karajan/.gitignore
  let isNewProject = false;
  try {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(projectDir);
    const relevant = entries.filter(e => !e.startsWith(".git") && e !== ".karajan" && e !== ".gitignore");
    isNewProject = relevant.length === 0;
  } catch { /* ignore */ }

  // Extract stack hints from planner + architect output
  const stackHints = [];
  const combined = `${stageResults.planner?.plan || ""} ${stageResults.architect?.architecture ? JSON.stringify(stageResults.architect.architecture) : ""} ${task}`.toLowerCase();
  const stackKeywords = ["express", "vite", "vitest", "jest", "next", "astro", "react", "vue", "svelte", "fastapi", "django", "spring", "gin", "nestjs", "monorepo", "workspaces"];
  for (const kw of stackKeywords) {
    if (combined.includes(kw)) stackHints.push(kw);
  }

  const batch = generateHuBatch({
    originalTask: task,
    subtasks,
    stackHints,
    isNewProject,
    researcherContext: stageResults.researcher?.summary || null,
    architectContext: stageResults.architect?.architecture ? JSON.stringify(stageResults.architect.architecture) : null
  });

  // Persist batch to HU store so hu-sub-pipeline can update story status via saveHuBatch.
  // Use session.id as batchSessionId.
  const batchSessionId = `auto-${session.id}`;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getKarajanHome } = await import("../utils/paths.js");
    const huDir = path.join(getKarajanHome(), "hu-stories", batchSessionId);
    await fs.mkdir(huDir, { recursive: true });
    const persistBatch = {
      session_id: batchSessionId,
      project_id: batchSessionId,
      project_name: batch.projectName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stories: batch.stories
    };
    await fs.writeFile(path.join(huDir, "batch.json"), JSON.stringify(persistBatch, null, 2));
  } catch (err) {
    logger.warn(`Auto-HU: failed to persist batch (${err.message}) — sub-pipeline will use in-memory fallback`);
  }

  // Wrap in format compatible with needsSubPipeline + runHuSubPipeline
  stageResults.huReviewer = {
    ok: true,
    stories: batch.stories,
    total: batch.total,
    certified: batch.certified,
    batchSessionId,
    auto_generated: true,
    source: batch.source
  };

  logger.info(`Auto-HU: generated ${batch.total} stories (${batch.source.triage_subtasks} subtasks${isNewProject ? ", new project" : ""}${stackHints.length ? `, stack: ${stackHints.join(",")}` : ""})`);
  emitProgress(emitter, makeEvent("hu:auto-generated", { ...eventBase, stage: "hu-auto-gen" }, {
    message: `Auto-generated ${batch.total} HU(s) from triage decomposition`,
    detail: { total: batch.total, subtasks: batch.source.triage_subtasks, isNewProject, stackHints, projectName: batch.projectName }
  }));

  // Auto-start the board so the user can see the generated HUs.
  // Always fires when auto-HU runs, independent of hu_board.auto_start flag.
  // Never during vitest — would race the PID file and leave a detached
  // node process around after the suite (TSK-0273).
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;
  try {
    const { startBoard, renderBoardBanner } = await import("../commands/board.js");
    const desiredPort = session.config_snapshot?.hu_board?.port ?? 4000;
    const boardResult = await startBoard(desiredPort);
    const url = boardResult.url;
    const status = boardResult.alreadyRunning ? "already running" : "started";
    const projectName = batch.projectName || "Auto-generated HUs";
    console.log(renderBoardBanner({ url, status, projectName }));
    logger.info(`HU Board ${status} at ${url} (project: ${projectName})`);
  } catch (err) {
    logger.warn(`HU Board auto-start failed (non-blocking): ${err.message}`);
  }
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
    const { generateDiff: genDiff, computeBaseRef: compBase } = await import("../review/diff-generator.js");
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

async function runQualityGateStages({ config, logger, emitter, eventBase, session, trackBudget, i, askQuestion, repeatDetector, budgetSummary, sonarState, task, stageResults, coderRole, pipelineFlags, brainCtx }) {
  const tddResult = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: i, askQuestion, task, brainCtx });
  if (tddResult.action === "pause") return { action: "return", result: tddResult.result };
  if (tddResult.action === "continue") return { action: "continue" };

  // Sonar runs for code tasks per policy. Since v2.7.4 it is NOT
  // toggleable via config — that's intrinsic to Karajan. The taskType
  // policy (resolved_policies.sonar) is the single source of truth.
  // Solomon may skip a single iteration via rule alerts; that's a
  // runtime decision, not a config option.
  //
  // Test-harness escape hatch via config.testHarness.disableSonarStage
  // (populated from globalThis.__KJ_DISABLE_SONAR_STAGE by the loader
  // for back-compat with tests/setup.js). Production code reads config
  // only; globalThis is not touched here.
  const sonarStageDisabledForTest = config?.testHarness?.disableSonarStage === true;
  if (!sonarStageDisabledForTest && session.resolved_policies?.sonar !== false) {
    const sonarResult = await runSonarStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i,
      repeatDetector, budgetSummary, sonarState, askQuestion, task, brainCtx
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
        const { createAgent } = await import("../agents/index.js");
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


async function initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags }) {
  // Auto-init .karajan/ if missing (copies coder-rules, review-rules, role templates)
  const initProjectDir = config.projectDir || process.cwd();
  await autoInit(initProjectDir, logger);

  // Smart role assignment: detect installed AIs and assign to roles
  // Only runs if: (a) no roles configured AND (b) not in test environment
  const needsAssignment = !config.roles?.coder?.provider && !config.coder && process.env.NODE_ENV !== "test" && !process.env.VITEST;
  if (needsAssignment) {
    try {
      const { autoAssignRoles, applyRoleAssignments } = await import("../utils/role-assigner.js");
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
  const { detectDevToolsMcp } = await import("../webperf/devtools-detect.js");
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
  const { budgetTracker, budgetLimit, budgetSummary, trackBudget } = createBudgetManager({
    config,
    emitter,
    eventBase: ctx.eventBase,
    // Provides fresh compression data for "With KJ vs Without KJ" comparison
    // (KJC-TSK-0274). Invoked on every budgetSummary() call.
    getCompressionStats: () => ({
      rtkSavings: ctx.rtkTracker?.hasData() ? ctx.rtkTracker.summary() : (ctx.session?.rtk_savings || null),
      brainCtx: ctx.brainCtx || null,
    }),
  });
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
  const { createBrainContext, isBrainEnabled } = await import("./brain-coordinator.js");
  ctx.brainCtx = createBrainContext({ enabled: isBrainEnabled(config) });
  if (ctx.brainCtx.enabled) {
    logger.info("Karajan Brain enabled — feedback queue, verification, compression active");
  }

  const { initPgAdapter } = await import("../planning-game/pipeline-adapter.js");
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
  // Use plannedTask (HU-scoped or planner-enriched) over the raw original task.
  // When running per-HU sub-pipelines, plannedTask is the HU's text, not the full spec.
  const { config, logger, emitter, eventBase, session, iteration: i } = ctx;
  const task = ctx.plannedTask || ctx.task;

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
    pipelineFlags: ctx.pipelineFlags, brainCtx: ctx.brainCtx
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
  // Uses the richer iteration-logger from TSK-0286: captures blocking-issue
  // details, sonar counts and Solomon rulings in addition to summaries.
  if (ctx.journalIterations) {
    try {
      const { recordIteration, extractIterationData } = await import("../session/journal/iteration-logger.js");
      const iterationData = extractIterationData({
        iteration: i,
        durationMs: iterDuration,
        stageResults: ctx.stageResults,
        session: ctx.session,
      });
      // Derive a richer reviewer summary if none was produced.
      if (!iterationData.reviewerSummary && review) {
        iterationData.reviewerSummary = review.approved
          ? `Approved: ${review.raw_summary || ""}`
          : `Rejected: ${(review?.blocking_issues || []).length} blocking issue(s)`;
      }
      if (!iterationData.blockingIssues || iterationData.blockingIssues.length === 0) {
        iterationData.blockingIssues = review?.blocking_issues || [];
      }
      recordIteration(ctx.session, iterationData);
    } catch (err) {
      logger.warn(`Iteration journal record failed (non-blocking): ${err.message}`);
    }
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
  // Defensive test-harness resolution for callers that bypass loadConfig()
  // (orchestrator unit tests that build raw config objects). Production
  // callers go through src/config/loader.js → loadConfig which already
  // runs resolveTestHarness() once. When config.testHarness is missing we
  // resolve it here using the same contract: explicit field → globalThis →
  // prod defaults. Idempotent — no-op when already present.
  if (config && !config.testHarness) {
    config.testHarness = resolveTestHarness(config.testHarness);
  }
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
    // tempSession needs `checkpoints` because invokeSolomon → addCheckpoint
    // pushes into it. Pre-v2.7.4 this lacked the array and crashed with
    // "Cannot read properties of undefined (reading 'push')" the moment
    // Solomon was consulted on a preflight failure.
    const tempSession = { id: "init-error", task, status: "failed", checkpoints: [] };
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
          iteration: 1, task: ctx.plannedTask, diff: postLoopDiff, askQuestion, brainCtx: ctx.brainCtx
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

      // Per-HU pipeline: focused max_iterations, fresh Brain state, own git branch.
      const originalMaxIterations = ctx.config.max_iterations;
      const huMaxIterations = ctx.config.hu_max_iterations ?? 3;
      const huBranches = new Map();
      const { prepareHuBranch, finalizeHuCommit } = await import("../git/hu-automation.js");
      const subPipelineResult = await runHuSubPipeline({
        huReviewerResult: ctx.stageResults.huReviewer,
        runIterationFn: async (huTask, story) => {
          ctx.config.max_iterations = huMaxIterations;
          if (ctx.brainCtx?.enabled) {
            ctx.brainCtx.extensionCount = 0;
            const { createBrainContext } = await import("./brain-coordinator.js");
            const fresh = createBrainContext({ enabled: true });
            ctx.brainCtx.feedbackQueue = fresh.feedbackQueue;
            ctx.brainCtx.verificationTracker = fresh.verificationTracker;
          }
          // Apply per-HU policies based on task_type (infra skips reviewer/sonar/tdd)
          const { applyPolicies } = await import("../guards/policy-resolver.js");
          const huPolicies = applyPolicies({ taskType: story.task_type, policies: ctx.config.policies });
          const savedFlags = { ...ctx.pipelineFlags };
          if (!huPolicies.reviewer) ctx.pipelineFlags.reviewerEnabled = false;
          if (!huPolicies.tdd) ctx.config.development = { ...ctx.config.development, methodology: "standard", require_test_changes: false };
          if (!huPolicies.sonar) ctx.config.sonarqube = { ...ctx.config.sonarqube, enabled: false };
          if (!huPolicies.testsRequired) ctx.pipelineFlags.testerEnabled = false;
          logger.info(`HU ${story.id} (${story.task_type}): policies → reviewer=${huPolicies.reviewer}, tdd=${huPolicies.tdd}, sonar=${huPolicies.sonar}, tests=${huPolicies.testsRequired}`);

          const branchName = await prepareHuBranch({ story, huBranches, config: ctx.config, logger });
          const projectDir = ctx.config.projectDir || process.cwd();

          // If HU has acceptance_tests, Brain runs them as the gate instead of
          // the standard reviewer/tester pipeline. This is the radical fix:
          // concrete executable tests replace subjective reviewer opinions.
          if (story.acceptance_tests?.length > 0) {
            const { runAcceptanceTests, buildDiagnosticPrompt } = await import("../hu/acceptance-runner.js");

            for (let attempt = 1; attempt <= ctx.config.max_iterations; attempt++) {
              logger.info(`HU ${story.id}: coder iteration ${attempt}/${ctx.config.max_iterations}`);
              emitProgress(emitter, makeEvent("iteration:start", { ...ctx.eventBase, stage: "iteration" }, {
                message: `Iteration ${attempt}/${ctx.config.max_iterations}`,
                detail: { iteration: attempt, maxIterations: ctx.config.max_iterations }
              }));

              // Coder runs with the HU task + any diagnostic feedback from previous attempt
              const coderResult = await runCoderStage({
                coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole,
                config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                session: ctx.session, plannedTask: ctx.plannedTask,
                trackBudget: ctx.trackBudget, iteration: attempt, brainCtx: ctx.brainCtx
              });
              if (coderResult?.action === "standby" || coderResult?.action === "pause") {
                return coderResult?.result || { approved: false, reason: "coder_failed" };
              }

              // Sonar quality gate (sw task_type only, when policies say sonar=true)
              if (huPolicies.sonar && ctx.config.sonarqube?.enabled) {
                try {
                  const sonarResult = await runSonarStage({
                    config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                    session: ctx.session, trackBudget: ctx.trackBudget, iteration: attempt,
                    askQuestion, brainCtx: ctx.brainCtx
                  });
                  if (sonarResult?.action === "continue") {
                    // Sonar failed — add to feedback for next coder attempt
                    ctx.plannedTask = `${huTask}\n\n--- SONAR FAILURE ---\n${ctx.session.last_reviewer_feedback}`;
                    continue;
                  }
                } catch (err) {
                  logger.warn(`HU ${story.id}: sonar stage failed (non-blocking): ${err.message}`);
                }
              }

              // Brain runs acceptance tests
              logger.info(`HU ${story.id}: running ${story.acceptance_tests.length} acceptance tests`);
              emitProgress(emitter, makeEvent("hu:acceptance-start", { ...ctx.eventBase, stage: "acceptance" }, {
                message: `Running ${story.acceptance_tests.length} acceptance tests`,
                detail: { huId: story.id, testCount: story.acceptance_tests.length }
              }));

              const testResult = await runAcceptanceTests(story.acceptance_tests, projectDir);
              emitProgress(emitter, makeEvent("hu:acceptance-end", { ...ctx.eventBase, stage: "acceptance" }, {
                status: testResult.allPassed ? "ok" : "fail",
                message: testResult.summary,
                detail: { allPassed: testResult.allPassed, results: testResult.results.map(r => ({ cmd: r.cmd, passed: r.passed })) }
              }));

              if (testResult.allPassed) {
                logger.info(`HU ${story.id}: all acceptance tests PASSED — approved`);
                await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
                return { approved: true, sessionId: ctx.session.id, reason: "acceptance_tests_passed" };
              }

              // Brain diagnoses failures and sends concrete fix to coder
              const failed = testResult.results.filter(r => !r.passed);
              const diagnostic = buildDiagnosticPrompt(failed);
              logger.warn(`HU ${story.id}: ${failed.length} acceptance test(s) FAILED — sending diagnostic to coder`);
              ctx.session.last_reviewer_feedback = diagnostic;
              ctx.plannedTask = `${huTask}\n\n--- ACCEPTANCE TEST FAILURES ---\n${diagnostic}`;
            }

            // All iterations exhausted
            logger.warn(`HU ${story.id}: max iterations reached with acceptance tests still failing`);
            return { approved: false, sessionId: ctx.session.id, reason: "acceptance_tests_failed" };
          }

          // Fallback: no acceptance_tests → standard pipeline (reviewer/tester)
          try {
            const result = await runIterationLoop(ctx, { task: huTask, askQuestion, emitter, logger });
            if (result?.approved) {
              await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
            }
            return result;
          } finally {
            ctx.config.max_iterations = originalMaxIterations;
            Object.assign(ctx.pipelineFlags, savedFlags);
          }
        },
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

      // Sync results back to plan file if this was a plan-based run
      if (ctx.session._syncResultsToPlan) {
        try {
          await ctx.session._syncResultsToPlan(subPipelineResult);
          logger.info("Plan updated with execution results");
        } catch (err) {
          logger.warn(`Failed to sync results to plan: ${err.message}`);
        }
      }

      const finalResult = {
        approved: subPipelineResult.approved,
        sessionId: ctx.session.id,
        huResults: subPipelineResult.results,
        blockedIds: subPipelineResult.blockedIds,
        planId: ctx.session._planRef?.planId || null
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
      const { sendTelemetryEvent } = await import("../utils/telemetry.js");
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
