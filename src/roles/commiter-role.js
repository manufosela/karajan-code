import { BaseRole } from "./base-role.js";
import {
  ensureGitRepo,
  currentBranch,
  fetchBase,
  ensureBranchUpToDateWithBase,
  hasChanges,
  commitAll,
  pushBranch,
  createPullRequest,
  revParse
} from "../utils/git.js";

function buildCommitMessage(task) {
  const clean = String(task || "")
    .replace(/\s+/g, " ")
    .trim();
  const prefix = "feat: ";
  const maxBody = 72 - prefix.length;
  return `${prefix}${clean.slice(0, maxBody) || "update"}`;
}

function buildPrTitle(task) {
  const clean = String(task || "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 70) || "Karajan update";
}

export class CommiterRole extends BaseRole {
  constructor({ config, logger, emitter = null }) {
    super({ name: "commiter", config, logger, emitter });
  }

  async execute(input) {
    const { task, commitMessage, push = false, createPr = false } = input || {};

    const isRepo = await ensureGitRepo();
    if (!isRepo) {
      return {
        ok: false,
        result: { error: "Current directory is not a git repository" },
        summary: "Commiter failed: not a git repo"
      };
    }

    const branch = await currentBranch();
    const changes = await hasChanges();

    if (!changes) {
      return {
        ok: true,
        result: { branch, committed: false, commitHash: null, prUrl: null },
        summary: "No changes to commit"
      };
    }

    const msg = commitMessage || buildCommitMessage(task);
    await commitAll(msg);
    const commitHash = await revParse("HEAD");

    if (push) {
      const baseBranch = this.config.base_branch || "main";
      await fetchBase(baseBranch);
      await ensureBranchUpToDateWithBase({
        branch,
        baseBranch,
        autoRebase: true
      });
      await pushBranch(branch);
    }

    let prUrl = null;
    if (push && createPr) {
      const baseBranch = this.config.base_branch || "main";
      prUrl = await createPullRequest({
        baseBranch,
        branch,
        title: buildPrTitle(task),
        body: `Task: ${task || "N/A"}`
      });
    }

    const parts = [`Committed on ${branch}`];
    if (push) parts.push("pushed");
    if (prUrl) parts.push(`PR: ${prUrl}`);

    return {
      ok: true,
      result: { branch, committed: true, commitHash, prUrl },
      summary: parts.join(", ")
    };
  }
}
