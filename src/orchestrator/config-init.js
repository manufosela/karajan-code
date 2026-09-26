/**
 * Configuration initialization and pipeline setup helpers.
 * Extracted from orchestrator.js — pure functions, no orchestration state.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { computeBaseRef, setSnapshot } from "../review/diff-generator.js";
import { ensureContractBlockPresent, excludeLocalArtifacts } from "../review/gate-gitignore.js";
import { revParse } from "../utils/git.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { getTemplatesRoot } from "../utils/templates-root.js";
import { BudgetTracker, extractUsageMetrics } from "../utils/budget.js";
import { DEFAULTS } from "../config/defaults.js";
import { computeKjComparison } from "../budget/comparison.js";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { projectSlug } from "../plan/plan-store.js";
import { applyPolicies } from "../guards/policy-resolver.js";
import { resolveReviewProfile } from "../review/profiles.js";
import { createSession } from "../session/store.js";
import { setResolvedPolicies } from "../session/mutators.js";
import { exists, ensureDir } from "../utils/fs.js";

/**
 * Auto-initialize .karajan/ in projectDir if missing.
 * Copies essential templates (coder-rules, review-rules) without running the full wizard.
 * Called by the orchestrator before the pipeline starts.
 */
export async function autoInit(projectDir, logger) {
  // Ensure git repo exists — without git, diff/reviewer/commit won't work.
  //
  // KJC-BUG-0060: the previous guard `!exists(projectDir/.git)` was insufficient
  // when projectDir is a subdirectory inside an existing repo (common in dogfooding
  // scenarios where kj-linked runs from the karajan-code source tree). In that case
  // `git commit --allow-empty` would resolve upward to the parent repo and land an
  // empty "initial commit" on the user's main branch. Use `git rev-parse
  // --is-inside-work-tree` instead — it follows the same upward traversal that git
  // does naturally, so a subdir inside a repo correctly reports `true` and we don't
  // touch anything. We also drop the `git commit --allow-empty -m "initial commit"`
  // step: a root commit is not required for any downstream stage (diff, review,
  // coder, sonar) and the empty-commit zombie history was the user-visible symptom.
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir, stdio: "pipe" });
    // Already inside a git work tree (own .git or parent's). Nothing to do.
  } catch {
    // Not inside any repo — create a fresh one. No empty seed commit.
    try {
      execFileSync("git", ["init"], { cwd: projectDir, stdio: "pipe" });
      logger.info("Initialized git repository (no seed commit)");
    } catch (err) {
      logger.warn(`Failed to init git repo: ${err.message}`);
    }
  }

  // KJC-BUG-0213 (issue #1734): el .gitignore es del equipo y viaja con el repo.
  // Ahi solo entra el contrato v4, que el equipo entero hereda; los artefactos
  // de una ejecucion son nuestros y locales, asi que van a .git/info/exclude.
  // Lo que kj metia antes (.env, *.log, .DS_Store) era opinion sobre un
  // proyecto ajeno, y aparecia en el diff de otra persona sin haberlo pedido.
  try {
    const contract = await ensureContractBlockPresent(projectDir);
    if (contract.changed) logger.info("El contrato v4 se ha anadido a .gitignore (lo hereda quien clone)");
    const local = await excludeLocalArtifacts(projectDir);
    if (local.changed) logger.info(`Artefactos de kj excluidos en .git/info/exclude: ${local.added.join(", ")}`);
  } catch (err) {
    logger.warn(`Failed to prepare .gitignore: ${err.message}`);
  }

  const karajanDir = path.join(projectDir, ".karajan");
  if (await exists(karajanDir)) return;

  logger.info("No .karajan/ found — auto-initializing project scaffolding");
  await ensureDir(karajanDir);

  const templatesDir = getTemplatesRoot();

  const filesToCopy = [
    { src: "coder-rules.md", dest: "coder-rules.md" },
    { src: "review-rules.md", dest: "review-rules.md" }
  ];

  for (const { src, dest } of filesToCopy) {
    const srcPath = path.join(templatesDir, src);
    const destPath = path.join(karajanDir, dest);
    try {
      if (!(await exists(destPath))) {
        const content = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, content, "utf8");
        logger.info(`  Created .karajan/${dest}`);
      }
    } catch (err) {
      logger.warn(`  Failed to copy ${src}: ${err.message}`);
    }
  }

  // Copy role templates directory
  const rolesTemplateDir = path.join(templatesDir, "roles");
  const rolesDestDir = path.join(karajanDir, "roles");
  try {
    if (await exists(rolesTemplateDir)) {
      await ensureDir(rolesDestDir);
      const roleFiles = await fs.readdir(rolesTemplateDir);
      for (const rf of roleFiles) {
        if (!rf.endsWith(".md")) continue;
        const destFile = path.join(rolesDestDir, rf);
        if (!(await exists(destFile))) {
          await fs.copyFile(path.join(rolesTemplateDir, rf), destFile);
        }
      }
      logger.info(`  Copied ${roleFiles.filter(f => f.endsWith(".md")).length} role templates to .karajan/roles/`);
    }
  } catch (err) {
    logger.warn(`  Failed to copy role templates: ${err.message}`);
  }
}

// KJC-BUG-0213 (issue #1734): aqui vivia updateGitignoreForStack, que deducia
// el stack buscando palabras como "ts" o "js" en el texto del plan y de la
// tarea. Cualquier frase las contiene, asi que un proyecto Laravel acabo con
// reglas de TypeScript en SU .gitignore. Un acierto por casualidad no vale para
// escribir en un fichero que no es nuestro: la funcion se retira entera.

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
    perfEnabled: Boolean(config.pipeline?.perf?.enabled),
    toolJudgeEnabled: Boolean(config.pipeline?.tool_judge?.enabled),
    reviewerEnabled: config.pipeline?.reviewer?.enabled !== false,
    discoverEnabled: Boolean(config.pipeline?.discover?.enabled),
    architectEnabled: Boolean(config.pipeline?.architect?.enabled),
    huReviewerEnabled: Boolean(config.pipeline?.hu_reviewer?.enabled),
  };
}

export async function handleDryRun({ task, config, flags, emitter, pipelineFlags }) {
  const { plannerEnabled, refactorerEnabled, researcherEnabled, testerEnabled, securityEnabled, impeccableEnabled, perfEnabled, reviewerEnabled, discoverEnabled, architectEnabled, huReviewerEnabled } = pipelineFlags;
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
      perf_enabled: perfEnabled,
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

export function createBudgetManager({ config, emitter, eventBase, getCompressionStats = null }) {
  const budgetTracker = new BudgetTracker({ pricing: config?.budget?.pricing });
  // KJC-BUG-0114: Number(null) === 0, so a config that reached us with
  // max_budget_usd: null produced a phantom "$X / $0.00" ceiling (and a
  // permanent warn state). null/undefined fall back to the shipped
  // default ceiling; an explicit 0 means "no ceiling".
  const rawBudget = config?.max_budget_usd;
  const budgetLimit = rawBudget == null ? DEFAULTS.max_budget_usd : Number(rawBudget);
  const hasBudgetLimit = Number.isFinite(budgetLimit) && budgetLimit > 0;
  const warnThresholdPct = Number(config?.budget?.warn_threshold_pct ?? 80);
  let stageCounter = 0;

  function budgetSummary() {
    const s = budgetTracker.summary();
    s.trace = budgetTracker.trace();
    // Attach the "With KJ vs Without KJ" comparison when compression data
    // is available (TSK-0274). hasCompression: false means no savings to
    // report; the display falls back to the plain cost line.
    if (typeof getCompressionStats === "function") {
      try {
        const stats = getCompressionStats() || {};
        s.kj_comparison = computeKjComparison({
          realTokens: s.total_tokens,
          realCost: s.total_cost_usd,
          rtkSavings: stats.rtkSavings,
          brainCtx: stats.brainCtx,
        });
      } catch { /* best-effort — omit comparison on failure */ }
    }
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
    // TSK-0340: `setSnapshot` now static; `takeSnapshot` kept dynamic because
    // snapshot-diff is ~600 LOC of dependency-free fs walking that most
    // runs don't need (only the greenfield/no-git path reaches here).
    const { takeSnapshot } = await import("../review/snapshot-diff.js");
    const snapshot = await takeSnapshot(config.projectDir || process.cwd());
    setSnapshot(snapshot);
  }

  // PR-F: stamp project_id on every session derived from the project
  // directory (slug = same algorithm the board uses to bucket plans).
  // Without this, sessions created by `kj run` from a terminal land
  // on disk with `project_id: null`. The board sync sees an orphan
  // and (used to) promote it to a phantom "Orphan sessions" project.
  // Now that PR-B blocks orphans on the board side, we must also fix
  // the source so the session can attach to a real project.
  const projectDir = config.projectDir || process.cwd();
  const project_id = projectSlug(projectDir);

  // Capture HEAD at the very start of the run, separately from base_ref.
  // session_start_sha was being conflated with base_ref (used for `git diff`)
  // — when the user's repo had a single commit and no remote main, base_ref
  // fell through to git's empty-tree SHA. The post-loop journal then read
  // session_start_sha to enumerate "commits made by this run" and got back
  // the entire history, including pre-existing commits. Capturing actual
  // HEAD here makes "what did the run produce?" deterministic and correct.
  // Falls back to baseRef when HEAD doesn't exist (zero-commits repo); in
  // that case "everything since baseRef" still equals "everything the run
  // produced" because there was no prior history.
  let headAtStart;
  try {
    headAtStart = (await revParse("HEAD")) || baseRef;
  } catch { headAtStart = baseRef; }

  const sessionInit = {
    task,
    project_id,
    config_snapshot: config,
    base_ref: baseRef,
    session_start_sha: baseRef,
    head_at_start: headAtStart,
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
  setResolvedPolicies(session, resolvedPolicies);

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
