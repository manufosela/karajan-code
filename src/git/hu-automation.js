/**
 * Per-HU git automation: branch, commit, push, PR per HU story.
 * Called from the HU sub-pipeline wrapper in orchestrator.js.
 */
import { commitAll, pushBranch, createPullRequest, hasChanges } from "../utils/git.js";
import { runCommand } from "../utils/process.js";

/**
 * Build a git-safe branch name for an HU story.
 * @param {string} prefix - e.g. "feat/"
 * @param {object} story - HU story {id, title}
 * @returns {string}
 */
export function buildHuBranchName(prefix, story) {
  const baseSlug = String(story.title || story.id || "hu")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${prefix}${story.id}-${baseSlug}`;
}

/**
 * Resolve the base branch for a given HU based on its dependencies.
 * If it has no blocked_by, uses config.base_branch.
 * If it has parents, uses the last-created parent branch (assumes parents ran first).
 *
 * @param {object} story - the HU story
 * @param {Map<string,string>} huBranches - map of huId → branchName (already created)
 * @param {string} baseBranch - config.base_branch fallback
 * @returns {string} base branch name
 */
export function resolveHuBase(story, huBranches, baseBranch) {
  const parents = story.blocked_by || [];
  if (parents.length === 0) return baseBranch;
  // Walk parents in reverse order of declaration to find the most recent one
  for (let i = parents.length - 1; i >= 0; i--) {
    const parentBranch = huBranches.get(parents[i]);
    if (parentBranch) return parentBranch;
  }
  return baseBranch;
}

/**
 * Create a branch for an HU starting from its resolved base.
 * Returns the branch name created (or null if git automation is disabled).
 *
 * @param {object} params
 * @param {object} params.story
 * @param {Map} params.huBranches
 * @param {object} params.config
 * @param {object} params.logger
 * @returns {Promise<string|null>}
 */
export async function prepareHuBranch({ story, huBranches, config, logger }) {
  if (!config.git?.auto_commit && !config.git?.auto_push && !config.git?.auto_pr) {
    return null;
  }
  const baseBranch = resolveHuBase(story, huBranches, config.base_branch || "main");
  const prefix = config.git?.branch_prefix || "feat/";
  const branchName = buildHuBranchName(prefix, story);

  // Checkout from the resolved base. Use `git checkout -B` to overwrite if rerun.
  const res = await runCommand("git", ["checkout", "-B", branchName, baseBranch], {});
  if (res.exitCode !== 0) {
    logger.warn(`HU git: failed to create branch ${branchName} from ${baseBranch}: ${res.stderr}`);
    return null;
  }
  huBranches.set(story.id, branchName);
  logger.info(`HU ${story.id}: branch '${branchName}' from '${baseBranch}'`);
  return branchName;
}

/**
 * After an HU is approved, commit its changes and optionally push + create PR.
 *
 * @param {object} params
 * @param {object} params.story
 * @param {string} params.branchName
 * @param {object} params.config
 * @param {object} params.logger
 * @returns {Promise<{committed: boolean, pushed: boolean, prUrl: string|null}>}
 */
export async function finalizeHuCommit({ story, branchName, config, logger }) {
  const result = { committed: false, pushed: false, prUrl: null };
  if (!branchName) return result;

  const changed = await hasChanges();
  if (!changed) {
    logger.info(`HU ${story.id}: no changes to commit`);
    return result;
  }

  const title = story.title || story.id;
  const commitMsg = `feat(${story.id}): ${title}`;
  if (config.git?.auto_commit) {
    const commitRes = await commitAll(commitMsg);
    if (commitRes) {
      result.committed = true;
      logger.info(`HU ${story.id}: committed on '${branchName}'`);
    }
  }

  if (config.git?.auto_push && result.committed) {
    try {
      await pushBranch(branchName);
      result.pushed = true;
      logger.info(`HU ${story.id}: pushed '${branchName}'`);
    } catch (err) {
      logger.warn(`HU ${story.id}: push failed: ${err.message}`);
    }
  }

  if (config.git?.auto_pr && result.pushed) {
    try {
      const prBody = [
        `## HU ${story.id}: ${title}`,
        "",
        story.certified?.text || "",
        "",
        "### Acceptance criteria",
        ...(story.acceptance_criteria || []).map(c => `- ${c}`)
      ].join("\n");
      const url = await createPullRequest({
        baseBranch: config.base_branch || "main",
        branch: branchName,
        title: commitMsg,
        body: prBody
      });
      result.prUrl = url;
      logger.info(`HU ${story.id}: PR created ${url}`);
    } catch (err) {
      logger.warn(`HU ${story.id}: PR creation failed: ${err.message}`);
    }
  }

  return result;
}
