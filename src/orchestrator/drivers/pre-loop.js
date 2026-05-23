/**
 * Pre-loop driver — extracted from src/orchestrator/flow-runner.js in
 * TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Everything that runs BEFORE the coder/reviewer iteration loop:
 *
 *   - runPreLoopStages:            the main pre-loop orchestration
 *                                  (HU-reviewer → intent → discover → triage →
 *                                  Brain decisor → domain → auto-simplify →
 *                                  PG decomposition → TDD detect → preflight →
 *                                  plan injection → planning phases →
 *                                  .gitignore update → auto-HU → skill
 *                                  auto-install).
 *   - runPlanningPhases:           researcher → architect → planner.
 *   - emitConfigDeprecations:      one-shot warnings for ignored config keys.
 *   - ensureAddyosmaniSkills:      refresh + resolve addyosmani/agent-skills.
 *   - maybeGenerateAutoHuBatch:    auto-generate HUs when triage recommends
 *                                  decomposition and no manual huFile was passed.
 *
 * Extracted verbatim; no behavior change. flow-runner.js now imports these
 * instead of defining them. initFlowContext lives in ./init-context.js to
 * keep each driver under the 600-LOC ceiling. Part of breaking up the
 * 2254-LOC god-module — see docs/ARCHITECTURE.md and the TSK-0335
 * acceptance criteria.
 */

import { emitProgress, makeEvent } from "../../utils/events.js";
import { resolveRole } from "../../config.js";
import { classifyIntent } from "../../guards/intent-guard.js";
import { persistInlineDomain } from "../../domains/domain-loader.js";
import { detectTestFramework } from "../../utils/project-detect.js";
import { detectNeededSkills, autoInstallSkills } from "../../skills/skill-detector.js";
import { refineSkillsSemantically, resolveSkillsMode } from "../../skills/semantic-detector.js";
import { saveSession } from "../../session/store.js";
import {
  setPreflight, setAutoInstalledSkills, setSkillsRecommended,
  setStageResult, setStageBundle,
} from "../../session/mutators.js";
import {
  runResearcherStage, runArchitectStage, runPlannerStage,
  runDiscoverStage, runHuReviewerStage,
} from "../pre-loop-stages.js";
// TSK-0336: triage goes through the StageRegistry / StageExecutor contract
// so canRun / execute / onFailure are actually exercised in production.
// The registry is a singleton with TriageStage / CoderStage / ReviewerStage
// pre-registered; `runStage` returns null when `canRun` vetoes execution.
import { stageRegistry } from "../stages/stage-classes.js";
import { runStage } from "../stages/stage-executor.js";
import { runDomainCuratorStage } from "../stages/domain-curator-stage.js";
import { runPreflightChecks } from "../preflight-checks.js";
import { injectLoadedPlan } from "./pre-loop-phases/inject-loaded-plan.js";
import { emitConfigDeprecations } from "./pre-loop-phases/config-deprecations.js";
import { ensureAddyosmaniSkills } from "./pre-loop-phases/ensure-addyosmani-skills.js";
import { maybeGenerateAutoHuBatch } from "./pre-loop-phases/auto-hu-batch.js";

import {
  applyTriageOverrides, applyAutoSimplify, applyFlagOverrides,
  resolvePipelinePolicies, updateGitignoreForStack,
} from "../config-init.js";
import { tryCiComment } from "../ci-integration.js";
import { getIntegration } from "../integrations.js";

export async function runPreLoopStages({ config, logger, emitter, eventBase, session, flags, pipelineFlags, coderRole, trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults, brainCtx }) {
  // KJC-BUG-0058: on `kj resume` `stageResults` is rehydrated from
  // `session.stage_results`. Persist after every successful pre-loop stage
  // and skip the work when the slot is already populated. Cost: one
  // `await saveSession` per stage; equivalent to the writes the post-loop
  // path already makes for security / acceptance results.
  const persistStage = async (name, result) => {
    if (!result) return;
    stageResults[name] = result;
    setStageResult(session, name, result);
    try { await saveSession(session); } catch (err) {
      logger.warn(`Could not persist '${name}' stage result: ${err.message}`);
    }
  };
  const resumeSkip = (name) => {
    if (!stageResults[name]) return false;
    logger.info(`[resume] skipping pre-loop stage '${name}' — completed in previous session`);
    emitProgress(emitter, makeEvent("stage:skipped", { ...eventBase, stage: name }, {
      status: "ok",
      message: `Stage '${name}' skipped — already completed on previous run`,
      detail: { cached: true }
    }));
    return true;
  };

  // --- HU Reviewer (first stage, before everything else, opt-in) ---
  const huFile = flags.huFile || null;
  if (flags.enableHuReviewer !== undefined) pipelineFlags.huReviewerEnabled = Boolean(flags.enableHuReviewer);
  if (pipelineFlags.huReviewerEnabled && huFile && !resumeSkip("huReviewer")) {
    const huResult = await runHuReviewerStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, huFile, askQuestion, pgStories: null });
    await persistStage("huReviewer", huResult.stageResult);
  }

  // --- Intent classifier (deterministic pre-triage, opt-in) ---
  if (config.guards?.intent?.enabled && !resumeSkip("intent")) {
    const intentResult = classifyIntent(task, config);
    await persistStage("intent", intentResult);
    if (intentResult.classified) {
      emitProgress(emitter, makeEvent("intent:classified", { ...eventBase, stage: "intent" }, {
        message: `Intent classified: ${intentResult.taskType} (${intentResult.level}) — ${intentResult.message}`,
        detail: intentResult
      }));
    }
  }

  // --- Discover (pre-triage, opt-in) ---
  if (flags.enableDiscover !== undefined) pipelineFlags.discoverEnabled = Boolean(flags.enableDiscover);
  if (pipelineFlags.discoverEnabled && !resumeSkip("discover")) {
    const discoverResult = await runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
    await persistStage("discover", discoverResult.stageResult);
  }

  // --- Triage (always on) — routed through StageRegistry (TSK-0336) ---
  // KJC-BUG-0058: NOT skipped on resume. Triage is cheap and emits
  // `roleOverrides` that downstream stages depend on (Brain decisor + the
  // pipelineFlags). Re-running it on resume is the safe path; the heavy
  // stages it gates (researcher, architect, planner) ARE skipped if
  // already complete.
  const triageCtx = { config, logger, emitter, eventBase, session, coderRole, trackBudget, pipelineFlags };
  const triageResult = await runStage(stageRegistry.get("triage"), triageCtx) ?? { roleOverrides: null, stageResult: null };
  applyTriageOverrides(pipelineFlags, triageResult.roleOverrides);
  await persistStage("triage", triageResult.stageResult);

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
      const { buildDecision, applyDecisionToFlags } = await import("../../brain/decisor.js");
      const { createTracker, recordDecision, checkLimits } = await import("../../brain/decision-tracker.js");
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
            const { consultSolomonForRouting } = await import("../../brain/solomon-consult.js");
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
  if ((domainHints.length > 0 || config.projectDir) && !resumeSkip("domainCurator")) {
    try {
      const { domainContext, stageResult: dcStageResult } = await runDomainCuratorStage({
        config, logger, emitter, eventBase, session, trackBudget,
        domainHints, askQuestion
      });
      await persistStage("domainCurator", dcStageResult);
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
    // Feed tracker card structured data to hu-reviewer when available
    let pgStories = null;
    if (pgTaskId && pgProject && session.pg_card) {
      pgStories = getIntegration("tracker")?.buildHuStoriesFromCard?.(session.pg_card) ?? null;
    }
    const huResult = await runHuReviewerStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, huFile: null, askQuestion, pgStories });
    await persistStage("huReviewer", huResult.stageResult);
  }

  // --- Auto-simplify pipeline for simple tasks (before explicit flag overrides) ---
  const simplified = applyAutoSimplify({
    pipelineFlags,
    triageLevel: triageResult.stageResult?.level || null,
    config, flags, logger, emitter, eventBase
  });
  if (simplified) stageResults.triage.autoSimplified = true;

  await getIntegration("tracker")?.handleDecomposition?.({ triageResult, pgTaskId, pgProject, config, askQuestion, emitter, eventBase, session, stageResults, logger });

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
  setPreflight(session, preflightResult);
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
  // Extracted to pre-loop-phases/inject-loaded-plan.js (PR-K).
  // 189 LOC of plan-load + tests-gate + auto-certify + assertRunnable +
  // huBatch + --hu filter + callback wiring + plannedTask build.
  const planInjection = await injectLoadedPlan({
    flags, updatedConfig, session, stageResults, eventBase, emitter, logger, task,
  });
  if (planInjection.handled) {
    return { plannedTask: planInjection.plannedTask, updatedConfig };
  }


  // --- Researcher → Planner ---
  const { plannedTask } = await runPlanningPhases({ config: updatedConfig, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx, persistStage, resumeSkip });

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
        setAutoInstalledSkills(session, skillResult.installed);
      }
      if (skillResult.osAvailable === false && skillResult.wouldHaveUsed.length > 0) {
        setSkillsRecommended(session, skillResult.wouldHaveUsed);
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
async function runPlanningPhases({ config, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx, persistStage, resumeSkip }) {
  let researchContext = null;
  let plannedTask = task;

  // Brain: track compression across pre-loop roles
  const brainCompress = brainCtx?.enabled
    ? (await import("../brain-coordinator.js")).processRoleOutput
    : null;

  // KJC-BUG-0058: on resume, rehydrate cross-stage context from session.
  // researchContext / architectContext / plannedTask live ONLY in memory
  // after their owning stage runs; without these the post-loop coder
  // would lose context even though we skipped the upstream LLM call.
  const bundles = session?.stage_bundles || {};

  if (pipelineFlags.researcherEnabled) {
    if (resumeSkip("researcher")) {
      researchContext = bundles.researcher?.researchContext || null;
    } else {
      const researcherResult = await runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });
      researchContext = researcherResult.researchContext;
      setStageBundle(session, "researcher", { stageResult: researcherResult.stageResult, researchContext });
      await persistStage("researcher", researcherResult.stageResult);
      if (brainCompress) brainCompress(brainCtx, { roleName: "researcher", output: researcherResult.stageResult, iteration: 0 });
    }
  }

  // --- Architect (between researcher and planner) ---
  let architectContext = null;
  if (pipelineFlags.architectEnabled) {
    if (resumeSkip("architect")) {
      architectContext = bundles.architect?.architectContext || null;
    } else {
      const architectResult = await runArchitectStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        researchContext,
        discoverResult: stageResults.discover || null,
        triageLevel: stageResults.triage?.level || null,
        askQuestion
      });
      architectContext = architectResult.architectContext;
      setStageBundle(session, "architect", { stageResult: architectResult.stageResult, architectContext });
      await persistStage("architect", architectResult.stageResult);
      if (brainCompress) brainCompress(brainCtx, { roleName: "architect", output: architectResult.stageResult, iteration: 0 });
    }
  }

  const triageDecomposition = stageResults.triage?.shouldDecompose ? stageResults.triage.subtasks : null;
  if (pipelineFlags.plannerEnabled) {
    if (resumeSkip("planner")) {
      plannedTask = bundles.planner?.plannedTask || task;
    } else {
      const plannerRole = resolveRole(config, "planner");
      const plannerResult = await runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, architectContext, triageDecomposition, trackBudget });
      plannedTask = plannerResult.plannedTask;
      setStageBundle(session, "planner", { stageResult: plannerResult.stageResult, plannedTask });
      await persistStage("planner", plannerResult.stageResult);
      if (brainCompress) brainCompress(brainCtx, { roleName: "planner", output: plannerResult.stageResult, iteration: 0 });

      await tryCiComment({
        config, session, logger,
        agent: "Planner",
        body: `Plan: ${plannerResult.stageResult?.summary || plannedTask}`
      });
    }
  }

  return { plannedTask };
}
// `emitConfigDeprecations`, `ensureAddyosmaniSkills` and
// `maybeGenerateAutoHuBatch` were extracted to ./pre-loop-phases/ in
// TSK-0337 to keep this driver under the 600-LOC ceiling. Imports at
// the top of this file pull them back in; behaviour is unchanged.
