/**
 * Configuration initialization and pipeline setup helpers.
 * Extracted from orchestrator.js — pure functions, no orchestration state.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { computeBaseRef, setSnapshot } from "../review/diff-generator.js";
import { revParse } from "../utils/git.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { getTemplatesRoot } from "../utils/templates-root.js";
import { BudgetTracker, extractUsageMetrics } from "../utils/budget.js";
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

  // Ensure .gitignore exists with universal entries only (stack-specific added after planner)
  const gitignorePath = path.join(projectDir, ".gitignore");
  const universalIgnores = [".env", "*.log", ".DS_Store", ".karajan/", ".reviews/"];
  try {
    let content = "";
    if (await exists(gitignorePath)) {
      content = await fs.readFile(gitignorePath, "utf8");
    }
    const missing = universalIgnores.filter(entry => !content.includes(entry));
    if (missing.length > 0) {
      const append = (content && !content.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n";
      await fs.appendFile(gitignorePath, append, "utf8");
      logger.info(`Created .gitignore with universal entries`);
    }
  } catch (err) {
    logger.warn(`Failed to create .gitignore: ${err.message}`);
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

// Stack-specific .gitignore patterns keyed by language/framework
const STACK_GITIGNORE = {
  javascript: ["node_modules/", "dist/", "build/", "coverage/", ".cache/", "*.tsbuildinfo"],
  typescript: ["node_modules/", "dist/", "build/", "coverage/", ".cache/", "*.tsbuildinfo"],
  python: ["__pycache__/", "*.pyc", ".venv/", "venv/", "*.egg-info/", ".pytest_cache/", "htmlcov/", ".mypy_cache/"],
  java: ["target/", "*.class", "*.jar", "*.war", ".gradle/", "build/", ".settings/", ".classpath", ".project"],
  kotlin: ["target/", "*.class", "build/", ".gradle/", ".kotlin/"],
  go: ["bin/", "*.exe", "vendor/"],
  rust: ["target/", "Cargo.lock"],
  ruby: ["vendor/bundle/", ".bundle/", "coverage/", "tmp/"],
  php: ["vendor/", ".phpunit.result.cache", "storage/logs/"],
  csharp: ["bin/", "obj/", "*.suo", "*.user", "packages/", ".vs/"],
  swift: [".build/", "Packages/", "*.xcodeproj/", "DerivedData/"],
  dart: [".dart_tool/", "build/", ".packages"],
};

/**
 * Update .gitignore with stack-specific entries after planner/architect decides the stack.
 * Detects stack from: triage taskType, architect output, planner output, or task keywords.
 */
export async function updateGitignoreForStack(projectDir, { stageResults, task, logger }) {
  const gitignorePath = path.join(projectDir, ".gitignore");
  const detected = new Set();

  // From architect — if it chose layers/patterns, it may hint at the language
  const arch = stageResults?.architect?.architecture;
  if (arch) {
    const archText = JSON.stringify(arch).toLowerCase();
    for (const lang of Object.keys(STACK_GITIGNORE)) {
      if (archText.includes(lang)) detected.add(lang);
    }
  }

  // From planner — scan plan text for language keywords
  const planText = (stageResults?.planner?.plan || "").toLowerCase();
  // From task description
  const taskText = (task || "").toLowerCase();
  const combined = `${planText} ${taskText}`;

  const langKeywords = {
    javascript: ["node", "npm", "express", "react", "vue", "next", "vite", "vitest", "jest", "pnpm", "yarn", "javascript", "js"],
    typescript: ["typescript", "tsx", "tsc"],
    python: ["python", "django", "flask", "fastapi", "pip", "pytest", "poetry"],
    java: ["java", "spring", "maven", "gradle", "junit"],
    kotlin: ["kotlin", "ktor"],
    go: ["golang", "go mod", "gin", "fiber"],
    rust: ["rust", "cargo", "tokio"],
    ruby: ["ruby", "rails", "gem", "bundler", "rspec"],
    php: ["php", "laravel", "composer", "symfony"],
    csharp: ["c#", "csharp", "dotnet", ".net", "aspnet"],
    swift: ["swift", "swiftui", "vapor"],
    dart: ["dart", "flutter"],
  };

  for (const [lang, keywords] of Object.entries(langKeywords)) {
    if (keywords.some(kw => combined.includes(kw))) detected.add(lang);
  }

  if (detected.size === 0) return;

  // Collect all entries for detected stacks
  const entries = [];
  for (const lang of detected) {
    entries.push(...(STACK_GITIGNORE[lang] || []));
  }
  const unique = [...new Set(entries)];

  try {
    let content = "";
    if (await exists(gitignorePath)) {
      content = await fs.readFile(gitignorePath, "utf8");
    }
    const missing = unique.filter(entry => !content.includes(entry));
    if (missing.length > 0) {
      const header = `\n# ${[...detected].join(" + ")} project\n`;
      const append = header + missing.join("\n") + "\n";
      await fs.appendFile(gitignorePath, append, "utf8");
      logger.info(`Updated .gitignore for ${[...detected].join(" + ")}: ${missing.join(", ")}`);
    }
  } catch (err) {
    logger.warn(`Failed to update .gitignore for stack: ${err.message}`);
  }
}

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
  const budgetLimit = Number(config?.max_budget_usd);
  const hasBudgetLimit = Number.isFinite(budgetLimit) && budgetLimit >= 0;
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
