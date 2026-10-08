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
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
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
 * Resolve to an actually-existing local ref. Tries the preferred branch
 * first, then `main` and `master`, then plain `HEAD` as last resort.
 *
 * Why: N6 plan-flow dogfooding (2026-05-07) on a `git init -q` repo
 * with `init.defaultBranch=master` produced 7 identical warnings:
 *   `failed to create branch feat/...-001 from main:
 *    fatal: 'main' is not a commit and a branch can't be created`.
 * Every HU then fell back to running on the original branch, which
 * defeats the per-HU isolation the sub-pipeline was supposed to give.
 *
 * The configured base_branch is honoured when it exists; otherwise we
 * pick the most likely default. HEAD always exists once the repo has
 * any commit, so the fallback never throws past the gate.
 *
 * @param {string} preferred
 * @returns {Promise<string>}
 */
async function resolveExistingBranchRef(preferred) {
  const candidates = [preferred, "main", "master", "HEAD"]
    .filter((c, i, arr) => c && arr.indexOf(c) === i); // unique, truthy
  for (const ref of candidates) {
    const probe = await runCommand("git", ["rev-parse", "--verify", "--quiet", ref], {});
    if (probe.exitCode === 0) return ref;
  }
  return preferred; // give up; caller will surface the original error
}

/** Whether a branch name references the card, as a whole token (BB-002 is not BB-0022). */
export function branchReferencesCard(branch, cardId) {
  const id = String(cardId).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`(^|[^a-z0-9])${id}([^a-z0-9]|$)`, "i").test(String(branch || ""));
}

async function cardBranch({ cardId, story, config, logger }) {
  const head = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {});
  const current = head.exitCode === 0 ? head.stdout.trim() : "";
  if (branchReferencesCard(current, cardId)) {
    logger.info(`HU ${story.id}: on '${current}', the branch of card ${cardId}`);
    return current;
  }
  const branchName = buildHuBranchName(config.git?.branch_prefix || "feat/", { id: cardId, title: story.title });
  // A card branch left by an earlier run keeps its commits: taken, never reset.
  const exists = await runCommand("git", ["rev-parse", "--verify", "--quiet", branchName], {});
  const base = exists.exitCode === 0 ? null : await resolveExistingBranchRef(config.base_branch || "main");
  const how = base ? `created from '${base}'` : "taken";
  const res = await runCommand("git", base ? ["checkout", "-b", branchName, base] : ["checkout", branchName], {});
  if (res.exitCode !== 0) {
    logger.warn(`HU git: branch ${branchName} could not be ${how}: ${res.stderr}`);
    return null;
  }
  logger.info(`HU ${story.id}: branch '${branchName}' ${how} for card ${cardId}`);
  return branchName;
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
export async function prepareHuBranch({ story, huBranches, config, logger, cardId = null }) {
  if (!config.git?.auto_commit && !config.git?.auto_push && !config.git?.auto_pr) {
    return null;
  }
  // KJC-BUG-0249 (#1896): with a Planning Game card the run is that card's
  // work and lives on ONE branch named after it: the current one when it
  // already references the card, else feat/<CARD-ID>-<slug>, created once
  // and shared by every HU. HU ids name branches only when there is no card.
  if (cardId) {
    const known = huBranches.get(cardId);
    const branch = known ?? (await cardBranch({ cardId, story, config, logger }));
    if (!branch) return null;
    huBranches.set(cardId, branch);
    huBranches.set(story.id, branch);
    return branch;
  }
  const baseBranch = resolveHuBase(story, huBranches, config.base_branch || "main");
  const effectiveBase = await resolveExistingBranchRef(baseBranch);
  if (effectiveBase !== baseBranch) {
    logger.info(`HU git: configured base '${baseBranch}' not found locally — using '${effectiveBase}' instead`);
  }
  const prefix = config.git?.branch_prefix || "feat/";
  const branchName = buildHuBranchName(prefix, story);

  // Checkout from the resolved base. Use `git checkout -B` to overwrite if rerun.
  const res = await runCommand("git", ["checkout", "-B", branchName, effectiveBase], {});
  if (res.exitCode !== 0) {
    logger.warn(`HU git: failed to create branch ${branchName} from ${effectiveBase}: ${res.stderr}`);
    return null;
  }
  huBranches.set(story.id, branchName);
  logger.info(`HU ${story.id}: branch '${branchName}' from '${effectiveBase}'`);
  return branchName;
}

/**
 * KJC-BUG-0248 (#1895): the remedy for a push git refused, read from its
 * message. GitHub refuses a push that adds or changes a workflow file when
 * the token lacks the `workflow` scope; that one has an exact fix.
 */
export function pushRemedy(message, branch) {
  if (/workflow/i.test(message) && /scope/i.test(message)) {
    return `the token lacks the workflow scope: run gh auth refresh -h github.com -s workflow, then git push -u origin ${branch}`;
  }
  return `push the branch yourself: git push -u origin ${branch}`;
}

/** The warnings a run reports when the push or the PR of any HU failed. */
export function collectGitWarnings(results) {
  return results.flatMap((r) => (r.result?.git?.errors ?? []).map((e) => `${r.huId}: ${e.step} failed: ${e.message}. ${e.remedy}`));
}

/**
 * After an HU is approved, commit its changes and optionally push + create PR.
 * A push or PR that fails is not only a warn line: it travels in `errors`
 * with its remedy, so the run's result says it (KJC-BUG-0248).
 *
 * @param {object} params
 * @param {object} params.story
 * @param {string} params.branchName
 * @param {object} params.config
 * @param {object} params.logger
 * @returns {Promise<{committed: boolean, pushed: boolean, prUrl: string|null, branch: string|null, errors: Array<{step: string, message: string, remedy: string}>}>}
 */
export async function finalizeHuCommit({ story, branchName, config, logger, cwd = null }) {
  const result = { committed: false, pushed: false, prUrl: null, branch: branchName || null, errors: [] };
  if (!branchName) return result;

  const changed = await hasChanges(cwd);
  if (!changed) {
    logger.info(`HU ${story.id}: no changes to commit`);
    return result;
  }

  const title = story.title || story.id;
  const commitMsg = `feat(${story.id}): ${title}`;
  if (config.git?.auto_commit) {
    const commitRes = await commitAll(commitMsg, cwd);
    if (commitRes) {
      result.committed = true;
      logger.info(`HU ${story.id}: committed on '${branchName}'`);
    }
  }

  if (config.git?.auto_push && result.committed) {
    try {
      await pushBranch(branchName, cwd);
      result.pushed = true;
      logger.info(`HU ${story.id}: pushed '${branchName}'`);
    } catch (err) {
      const remedy = pushRemedy(err.message, branchName);
      result.errors.push({ step: "push", message: err.message, remedy });
      logger.warn(`HU ${story.id}: push failed: ${err.message} (${remedy})`);
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
        body: prBody,
        cwd
      });
      result.prUrl = url;
      logger.info(`HU ${story.id}: PR created ${url}`);
    } catch (err) {
      const remedy = `open the PR yourself: gh pr create --base ${config.base_branch || "main"} --head ${branchName}`;
      result.errors.push({ step: "pr", message: err.message, remedy });
      logger.warn(`HU ${story.id}: PR creation failed: ${err.message} (${remedy})`);
    }
  }

  return result;
}
