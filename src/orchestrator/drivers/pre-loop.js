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
import {
  refreshIfStale as refreshAddyosmaniCatalog,
  listAvailableSlugs as listAddyosmaniSlugs,
} from "../../skills/addyosmani-catalog.js";
import { resolveAddyosmaniSlugs } from "../../skills/addyosmani-role-map.js";
import { saveSession } from "../../session/store.js";
import {
  runTriageStage, runResearcherStage, runArchitectStage, runPlannerStage,
  runDiscoverStage, runHuReviewerStage,
} from "../pre-loop-stages.js";
import { runDomainCuratorStage } from "../stages/domain-curator-stage.js";
import { runPreflightChecks } from "../preflight-checks.js";
import {
  applyTriageOverrides, applyAutoSimplify, applyFlagOverrides,
  resolvePipelinePolicies, updateGitignoreForStack,
} from "../config-init.js";
import { tryCiComment } from "../ci-integration.js";

export async function runPreLoopStages({ config, logger, emitter, eventBase, session, flags, pipelineFlags, coderRole, trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults, brainCtx }) {
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
      const { buildHuStoriesFromPgCard } = await import("../../planning-game/pipeline-adapter.js");
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

  const { handlePgDecomposition } = await import("../../planning-game/pipeline-adapter.js");
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
      const { loadPlan, savePlan: savePlanToDisk } = await import("../../plan/plan-store.js");
      const { isPlanV2 } = await import("../../plan/plan-schema.js");
      const { planToHuBatch, syncResultsToPlan } = await import("../../plan/plan-executor.js");
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
export async function runPlanningPhases({ config, logger, emitter, eventBase, session, stageResults, pipelineFlags, coderRole, trackBudget, task, askQuestion, brainCtx }) {
  let researchContext = null;
  let plannedTask = task;

  // Brain: track compression across pre-loop roles
  const brainCompress = brainCtx?.enabled
    ? (await import("../brain-coordinator.js")).processRoleOutput
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
export async function ensureAddyosmaniSkills({ task, config, logger, session, emitter, eventBase }) {
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

  const { generateHuBatch } = await import("../../hu/auto-generator.js");

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
    const { getKarajanHome } = await import("../../utils/paths.js");
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
    const { startBoard, renderBoardBanner } = await import("../../commands/board.js");
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
