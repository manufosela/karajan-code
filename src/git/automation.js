/**
 * Git automation helpers for the pipeline.
 * Extracted from orchestrator.js for testability and reuse.
 */

import { addCheckpoint } from "../session-store.js";
import {
  ensureGitRepo,
  currentBranch,
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
    .replace(/\s+/g, " ")
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
  await fetchBase(baseBranch);

  let branch = await currentBranch();
  if (branch === baseBranch) {
    await syncBaseBranch({ baseBranch, autoRebase });
    const created = buildBranchName(config.git.branch_prefix || "feat/", task);
    await createBranch(created);
    branch = created;
    logger.info(`Created working branch: ${branch}`);
    await addCheckpoint(session, { stage: "git-prep", branch, created: true });
  } else {
    await ensureBranchUpToDateWithBase({ branch, baseBranch, autoRebase });
    await addCheckpoint(session, { stage: "git-prep", branch, created: false });
  }

  return { enabled: true, branch, baseBranch, autoRebase };
}

export async function finalizeGitAutomation({ config, gitCtx, task, logger, session }) {
  if (!gitCtx?.enabled) return { git: "disabled" };

  const commitMsg = config.git.commit_message || commitMessageFromTask(task);
  let committed = false;
  if (config.git.auto_commit) {
    const commitResult = await commitAll(commitMsg);
    committed = commitResult.committed;
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

  let prUrl = null;
  if (config.git.auto_pr) {
    prUrl = await createPullRequest({
      baseBranch: gitCtx.baseBranch,
      branch: gitCtx.branch,
      title: commitMessageFromTask(task),
      body: "Created by Karajan Code."
    });
    await addCheckpoint(session, { stage: "git-pr", branch: gitCtx.branch, pr: prUrl });
    logger.info("Pull request created");
  }

  return { committed, branch: gitCtx.branch, prUrl };
}
