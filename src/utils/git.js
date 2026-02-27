import { runCommand } from "./process.js";

function slugifyTask(task) {
  return String(task)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function runGit(args, options = {}) {
  const res = await runCommand("git", args, options);
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

export async function ensureGitRepo() {
  const res = await runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export async function currentBranch() {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function fetchBase(baseBranch) {
  await runGit(["fetch", "origin", baseBranch]);
}

export async function revParse(ref) {
  return runGit(["rev-parse", ref]);
}

export async function syncBaseBranch({ baseBranch, autoRebase }) {
  const local = await revParse(baseBranch);
  const remote = await revParse(`origin/${baseBranch}`);
  if (local === remote) return { synced: true, rebased: false };

  if (!autoRebase) {
    throw new Error(
      `Base branch '${baseBranch}' is behind origin/${baseBranch}. Re-run with auto-rebase enabled or rebase manually.`
    );
  }

  await runGit(["rebase", `origin/${baseBranch}`]);
  return { synced: true, rebased: true };
}

export async function ensureBranchUpToDateWithBase({ branch, baseBranch, autoRebase }) {
  const mergeBase = await runGit(["merge-base", branch, `origin/${baseBranch}`]);
  const remoteBase = await revParse(`origin/${baseBranch}`);
  if (mergeBase === remoteBase) return { upToDate: true, rebased: false };

  if (!autoRebase) {
    throw new Error(
      `Base branch '${baseBranch}' advanced during run. Re-run with auto-rebase enabled or rebase '${branch}' manually.`
    );
  }

  await runGit(["rebase", `origin/${baseBranch}`]);
  return { upToDate: true, rebased: true };
}

export async function createBranch(branchName) {
  await runGit(["checkout", "-b", branchName]);
}

export function buildBranchName(prefix, task) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  return `${prefix}${slugifyTask(task) || "task"}-${stamp}`;
}

export async function hasChanges() {
  const status = await runGit(["status", "--porcelain"]);
  return status.length > 0;
}

export async function commitAll(message) {
  await runGit(["add", "-A"]);
  const changed = await hasChanges();
  if (!changed) return { committed: false };
  await runGit(["commit", "-m", message]);
  const raw = await runGit(["log", "-1", "--pretty=format:%H%x1f%s"]);
  const [hash, commitMessage] = raw.split("\x1f");
  return { committed: true, commit: { hash, message: commitMessage } };
}

export async function pushBranch(branch) {
  await runGit(["push", "-u", "origin", branch]);
}

export async function createPullRequest({ baseBranch, branch, title, body }) {
  const args = ["pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body", body];
  const res = await runCommand("gh", args);
  if (res.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}
