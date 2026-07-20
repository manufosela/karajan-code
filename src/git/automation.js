/**
 * Git automation helpers for the pipeline.
 * Extracted from orchestrator.js for testability and reuse.
 */

import { addCheckpoint } from "../session/store.js";
import {
  ensureGitRepo,
  currentBranch,
  hasCommits,
  fetchBase,
  syncBaseBranch,
  ensureBranchUpToDateWithBase,
  createBranch,
  buildBranchName,
  commitAll,
  pushBranch,
  createPullRequest,
  listPendingPaths,
  hasRemote
} from "../utils/git.js";

/**
 * Karajan writes / updates several internal directories during a pipeline
 * run (the workspace scaffold + the session journal). When they're the
 * ONLY thing pending at finalization, the post-loop commit shouldn't
 * inherit the user task's `feat:` message — it should be a clear
 * `chore: scaffold karajan workspace` so `git log --oneline` reads:
 *
 *     2d770aa  docs: add JSDoc comment to index.js
 *     abc1234  chore: scaffold karajan workspace
 *     8a95ef0  initial
 *
 * A path counts as scaffolding when it lives at one of these prefixes
 * OR is the project's root `.gitignore` (we extend it to include
 * stack-specific entries during triage).
 */
const KARAJAN_SCAFFOLD_PREFIXES = [
  ".karajan/",
  ".reviews/",
  ".kj/",
  ".agent/",
];

function isKarajanScaffoldPath(p) {
  if (p === ".gitignore") return true;
  return KARAJAN_SCAFFOLD_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * @param {string[]} paths
 * @returns {boolean} true when every pending path is a Karajan internal
 */
export function pendingPathsAreOnlyKarajanScaffold(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every(isKarajanScaffoldPath);
}

/**
 * Map the taskType (as classified by triage) to the matching
 * Conventional Commits prefix. When triage hasn't run or the type is
 * unknown we default to `feat:` (the pre-fix behaviour).
 */
const TASK_TYPE_TO_PREFIX = {
  doc: "docs",
  "add-tests": "test",
  refactor: "refactor",
  infra: "chore",
  sw: "feat",
};

function prefixForTaskType(taskType) {
  return TASK_TYPE_TO_PREFIX[taskType] || "feat";
}

export function commitMessageFromTask(task, taskType = null) {
  const clean = String(task || "")
    .replaceAll(/\s+/g, " ")
    .trim();
  const prefix = prefixForTaskType(taskType);
  return `${prefix}: ${clean.slice(0, 72) || "karajan update"}`;
}

/**
 * Build the message used by `finalizeGitAutomation` for the post-loop
 * commit. Two paths:
 *   - When the only pending changes are Karajan scaffold files
 *     (.gitignore, .karajan/, .reviews/, ...), use a fixed
 *     `chore: scaffold karajan workspace` message. This avoids the
 *     "duplicate feat:" git log seen when triage extends .gitignore
 *     for a freshly detected stack and the coder already committed
 *     the user-visible change.
 *   - Otherwise, fall back to `commitMessageFromTask(task, taskType)`,
 *     respecting the type for the prefix.
 */
export function buildFinalizeCommitMessage({ task, taskType, pendingPaths }) {
  if (pendingPathsAreOnlyKarajanScaffold(pendingPaths)) {
    return "chore: scaffold karajan workspace";
  }
  return commitMessageFromTask(task, taskType);
}

export async function prepareGitAutomation({ config, task, logger, session }) {
  const enabled = config.git.auto_commit || config.git.auto_push || config.git.auto_pr;
  if (!enabled) return { enabled: false };

  if (!(await ensureGitRepo())) {
    throw new Error("Git automation requested but current directory is not a git repository");
  }

  const baseBranch = config.base_branch;
  const autoRebase = config.git.auto_rebase !== false;
  const repoHasCommits = await hasCommits();

  // New repo without commits: create branch directly (no fetch/sync possible)
  if (!repoHasCommits) {
    const created = buildBranchName(config.git.branch_prefix || "feat/", task);
    // git checkout -b works even without commits (creates orphan-like branch on first commit)
    await createBranch(created);
    logger.info(`New repo — created working branch: ${created}`);
    await addCheckpoint(session, { stage: "git-prep", branch: created, created: true, newRepo: true });
    return { enabled: true, branch: created, baseBranch, autoRebase };
  }

  await fetchBase(baseBranch).catch(() => {
    // No remote — skip fetch (new project without push)
    logger.info("No remote configured — skipping fetch");
  });

  let branch;
  try {
    branch = await currentBranch();
  } catch {
    // HEAD exists but branch detection failed — unusual, treat as main
    branch = baseBranch;
  }

  if (branch === baseBranch) {
    await syncBaseBranch({ baseBranch, autoRebase }).catch(() => {
      // No remote tracking — skip sync for new projects
    });
    const created = buildBranchName(config.git.branch_prefix || "feat/", task);
    await createBranch(created);
    branch = created;
    logger.info(`Created working branch: ${branch}`);
    await addCheckpoint(session, { stage: "git-prep", branch, created: true });
  } else {
    await ensureBranchUpToDateWithBase({ branch, baseBranch, autoRebase }).catch(() => {
      // No remote tracking — skip rebase for new projects
      logger.info("No remote tracking — skipping rebase check");
    });
    await addCheckpoint(session, { stage: "git-prep", branch, created: false });
  }

  return { enabled: true, branch, baseBranch, autoRebase };
}

export function buildPrBody({ task: _task, stageResults }) {
  const sections = ["Created by Karajan Code."];

  const approach = stageResults?.planner?.approach;
  if (approach) {
    sections.push("", "## Approach", approach);
  }

  const steps = stageResults?.planner?.steps;
  if (steps?.length) {
    sections.push("", "## Steps");
    for (let i = 0; i < steps.length; i++) {
      sections.push(`${i + 1}. ${steps[i]}`);
    }
  }

  const triageSubtasks = stageResults?.triage?.subtasks;
  const shouldDecompose = stageResults?.triage?.shouldDecompose;
  const pendingSubtasks = shouldDecompose && triageSubtasks?.length > 1 ? triageSubtasks.slice(1) : [];
  if (pendingSubtasks.length > 0) {
    sections.push("", "## Pending subtasks", "This PR addresses part of a larger task. The following subtasks were identified but not included:");
    for (const subtask of pendingSubtasks) {
      sections.push(`- [ ] ${subtask}`);
    }
  }

  return sections.join("\n");
}

/**
 * Create an early PR after the first coder iteration (Karajan CI flow).
 * Commits, pushes, and creates a PR before the reviewer runs.
 * Returns { prNumber, prUrl, commits } or null if nothing to commit.
 */
export async function earlyPrCreation({ gitCtx, task, logger, session, stageResults = null }) {
  if (!gitCtx?.enabled) return null;

  const commitMsg = commitMessageFromTask(task);
  const commitResult = await commitAll(commitMsg);
  if (!commitResult.committed) {
    logger.info("earlyPrCreation: no changes to commit");
    return null;
  }

  const commits = commitResult.commit ? [commitResult.commit] : [];
  await addCheckpoint(session, { stage: "ci-commit", committed: true });

  await pushBranch(gitCtx.branch);
  await addCheckpoint(session, { stage: "ci-push", branch: gitCtx.branch });
  logger.info(`Pushed branch for early PR: ${gitCtx.branch}`);

  const body = buildPrBody({ task, stageResults });
  const prUrl = await createPullRequest({
    baseBranch: gitCtx.baseBranch,
    branch: gitCtx.branch,
    title: commitMessageFromTask(task),
    body
  });
  await addCheckpoint(session, { stage: "ci-pr", branch: gitCtx.branch, pr: prUrl });
  logger.info(`Early PR created: ${prUrl}`);

  // Extract PR number from URL (e.g. https://github.com/owner/repo/pull/42)
  const prNumber = Number.parseInt(prUrl.split("/").pop(), 10) || null;
  return { prNumber, prUrl, commits };
}

/**
 * Incremental push after each coder iteration (Karajan CI flow).
 * Commits and pushes without creating a new PR.
 */
export async function incrementalPush({ gitCtx, task, logger, session }) {
  if (!gitCtx?.enabled) return null;

  const commitMsg = commitMessageFromTask(task);
  const commitResult = await commitAll(commitMsg);
  if (!commitResult.committed) {
    logger.info("incrementalPush: no changes to commit");
    return null;
  }

  const commits = commitResult.commit ? [commitResult.commit] : [];
  await addCheckpoint(session, { stage: "ci-incremental-commit", committed: true });

  await pushBranch(gitCtx.branch);
  await addCheckpoint(session, { stage: "ci-incremental-push", branch: gitCtx.branch });
  logger.info(`Incremental push: ${gitCtx.branch}`);

  return { commits };
}

export async function finalizeGitAutomation({ config, gitCtx, task, logger, session, stageResults = null }) {
  if (!gitCtx?.enabled) return { git: "disabled", commits: [] };

  // Take a snapshot of pending paths BEFORE staging so we can decide
  // whether what's about to be committed is just Karajan scaffolding
  // (in which case we use `chore: scaffold karajan workspace`) or a
  // real, user-visible change (in which case we honour the task's
  // taskType for the Conventional Commits prefix).
  const taskType = stageResults?.triage?.taskType ?? null;
  let pendingPaths = [];
  if (config.git.auto_commit) {
    try {
      pendingPaths = await listPendingPaths();
    } catch { /* best-effort — fall back to default message */ }
  }

  const commitMsg =
    config.git.commit_message
    || buildFinalizeCommitMessage({ task, taskType, pendingPaths });

  let committed = false;
  const commits = [];
  if (config.git.auto_commit) {
    // ENV-F1: this path only runs after the pipeline's reviewer approved,
    // so stamp that verdict for the staged diff — the v4 pre-commit gate
    // (when the repo opted in) accepts the pipeline's own commit.
    const { stampStagedVerdict } = await import("../review/verdict-store.js");
    const commitResult = await commitAll(commitMsg, null, {
      beforeCommit: () => stampStagedVerdict({
        projectDir: config?.projectDir || process.cwd(),
        reviewer: config?.reviewer || "pipeline-reviewer",
        summary: `kj run session ${session?.id || ""}: reviewer approved`.trim(),
      }),
    });
    committed = commitResult.committed;
    if (commitResult.commit) {
      commits.push(commitResult.commit);
    }
    await addCheckpoint(session, { stage: "git-commit", committed });
    logger.info(committed ? "Committed changes" : "No changes to commit");
  }

  // KJC-BUG-0112: without an `origin` remote (the quickstart scenario:
  // fresh folder + git init) push/PR automation has nothing to talk to —
  // fetchBase used to throw here and escalate to Solomon on EVERY
  // iteration, burning the whole budget on an expected condition.
  const remoteAvailable = (config.git.auto_push || config.git.auto_pr)
    ? await hasRemote()
    : false;
  if ((config.git.auto_push || config.git.auto_pr) && !remoteAvailable) {
    logger.info("No remote configured — skipping push/PR automation");
    await addCheckpoint(session, { stage: "git-push", skipped: "no-remote" });
  }

  if (remoteAvailable && (config.git.auto_push || config.git.auto_pr)) {
    await fetchBase(gitCtx.baseBranch);
    await ensureBranchUpToDateWithBase({
      branch: gitCtx.branch,
      baseBranch: gitCtx.baseBranch,
      autoRebase: gitCtx.autoRebase
    });
    await addCheckpoint(session, { stage: "git-rebase-check", branch: gitCtx.branch });
  }

  if (remoteAvailable && (config.git.auto_push || config.git.auto_pr)) {
    await pushBranch(gitCtx.branch);
    await addCheckpoint(session, { stage: "git-push", branch: gitCtx.branch });
    logger.info(`Pushed branch: ${gitCtx.branch}`);
  }

  let prUrl = session.ci_pr_url || null;
  if (remoteAvailable && config.git.auto_pr && !prUrl) {
    const body = buildPrBody({ task, stageResults });
    prUrl = await createPullRequest({
      baseBranch: gitCtx.baseBranch,
      branch: gitCtx.branch,
      title: commitMessageFromTask(task),
      body
    });
    await addCheckpoint(session, { stage: "git-pr", branch: gitCtx.branch, pr: prUrl });
    logger.info("Pull request created");
  } else if (prUrl) {
    logger.info(`PR already exists (CI flow): ${prUrl}`);
  }

  return { committed, branch: gitCtx.branch, prUrl, pr: prUrl, commits };
}
