/**
 * Git automation helpers for the pipeline.
 * Extracted from orchestrator.js for testability and reuse.
 */

import { addCheckpoint } from "../session-store.js";
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
  createPullRequest
} from "../utils/git.js";

export function commitMessageFromTask(task) {
  const clean = String(task || "")
    .replaceAll(/\s+/g, " ")
    .trim();
  return `feat: ${clean.slice(0, 72) || "karajan update"}`;
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

export function buildPrBody({ task, stageResults }) {
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
 * Create an early PR after the first coder iteration (BecarIA Gateway flow).
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
  await addCheckpoint(session, { stage: "becaria-commit", committed: true });

  await pushBranch(gitCtx.branch);
  await addCheckpoint(session, { stage: "becaria-push", branch: gitCtx.branch });
  logger.info(`Pushed branch for early PR: ${gitCtx.branch}`);

  const body = buildPrBody({ task, stageResults });
  const prUrl = await createPullRequest({
    baseBranch: gitCtx.baseBranch,
    branch: gitCtx.branch,
    title: commitMessageFromTask(task),
    body
  });
  await addCheckpoint(session, { stage: "becaria-pr", branch: gitCtx.branch, pr: prUrl });
  logger.info(`Early PR created: ${prUrl}`);

  // Extract PR number from URL (e.g. https://github.com/owner/repo/pull/42)
  const prNumber = Number.parseInt(prUrl.split("/").pop(), 10) || null;
  return { prNumber, prUrl, commits };
}

/**
 * Incremental push after each coder iteration (BecarIA Gateway flow).
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
  await addCheckpoint(session, { stage: "becaria-incremental-commit", committed: true });

  await pushBranch(gitCtx.branch);
  await addCheckpoint(session, { stage: "becaria-incremental-push", branch: gitCtx.branch });
  logger.info(`Incremental push: ${gitCtx.branch}`);

  return { commits };
}

export async function finalizeGitAutomation({ config, gitCtx, task, logger, session, stageResults = null }) {
  if (!gitCtx?.enabled) return { git: "disabled", commits: [] };

  const commitMsg = config.git.commit_message || commitMessageFromTask(task);
  let committed = false;
  const commits = [];
  if (config.git.auto_commit) {
    const commitResult = await commitAll(commitMsg);
    committed = commitResult.committed;
    if (commitResult.commit) {
      commits.push(commitResult.commit);
    }
    await addCheckpoint(session, { stage: "git-commit", committed });
    logger.info(committed ? "Committed changes" : "No changes to commit");
  }

  if (config.git.auto_push || config.git.auto_pr) {
    await fetchBase(gitCtx.baseBranch);
    await ensureBranchUpToDateWithBase({
      branch: gitCtx.branch,
      baseBranch: gitCtx.baseBranch,
      autoRebase: gitCtx.autoRebase
    });
    await addCheckpoint(session, { stage: "git-rebase-check", branch: gitCtx.branch });
  }

  if (config.git.auto_push || config.git.auto_pr) {
    await pushBranch(gitCtx.branch);
    await addCheckpoint(session, { stage: "git-push", branch: gitCtx.branch });
    logger.info(`Pushed branch: ${gitCtx.branch}`);
  }

  let prUrl = session.becaria_pr_url || null;
  if (config.git.auto_pr && !prUrl) {
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
    logger.info(`PR already exists (BecarIA flow): ${prUrl}`);
  }

  return { committed, branch: gitCtx.branch, prUrl, pr: prUrl, commits };
}
