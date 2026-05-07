import { runCommand } from "./process.js";
import { getRunContext } from "./run-context.js";

/**
 * Module-scoped runner — legacy back-compat for callers outside a
 * `withRunContext` scope (CLI bootstrap, checks/system.js). When running
 * inside a pipeline, `getRunContext()?.runner` takes precedence and
 * provides per-run isolation (TSK-0338). When neither is set we fall
 * back to the bare `runCommand`.
 *
 * @type {((command: string, args?: string[], options?: object) => Promise<object>)|null}
 */
let _runner = null;

/**
 * Set the module-scope runner. Retained for back-compat: concurrent
 * `runFlow` invocations should rely on `withRunContext` for isolation,
 * not on this setter (the setter is process-wide and would cause the
 * exact cross-run contamination TSK-0338 eliminates).
 */
export function setRunner(runner) {
  _runner = runner;
}

function run(command, args, ...rest) {
  const ctxRunner = getRunContext()?.runner;
  return (ctxRunner || _runner || runCommand)(command, args, ...rest);
}

function slugifyTask(task) {
  return String(task)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-+)|(-+$)/g, "")
    .slice(0, 40);
}

async function runGit(args, options = {}) {
  const res = await run("git", args, options);
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

export async function ensureGitRepo() {
  const res = await run("git", ["rev-parse", "--is-inside-work-tree"]);
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export async function currentBranch() {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function hasCommits() {
  const res = await run("git", ["rev-parse", "HEAD"]);
  return res.exitCode === 0;
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
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 16);
  return `${prefix}${slugifyTask(task) || "task"}-${stamp}`;
}

export async function hasChanges() {
  const status = await runGit(["status", "--porcelain"]);
  return status.length > 0;
}

/**
 * Return the relative paths of every uncommitted change (modified,
 * untracked, staged, etc.) in the working tree. Each path is the
 * filename as `git status --porcelain` reports it (after the 2-char
 * status code + space). Returns an empty array when the tree is clean.
 *
 * Used by `finalizeGitAutomation` to decide whether the changes
 * pending at the end of a pipeline are exclusively Karajan
 * scaffolding (and thus deserve a `chore:` commit message instead
 * of inheriting the user task's `feat:`).
 *
 * NOTE: bypasses `runGit()` because that helper trims stdout, which
 * eats the leading space of porcelain lines whose first status char
 * is " " (e.g. " M .gitignore" → "M .gitignore"). The leading space
 * is structural here — without it the slice(3) below would crop one
 * character off the first path.
 */
export async function listPendingPaths() {
  const res = await run("git", ["status", "--porcelain"]);
  if (res.exitCode !== 0) {
    throw new Error(`git status --porcelain failed: ${res.stderr || res.stdout}`);
  }
  const stdout = res.stdout;
  if (!stdout) return [];
  const lines = stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // Each line is "XY <path>" (XY = 2-char status, space, path).
    // Renames look like "R  old -> new"; we want the new path.
    const after = line.slice(3);
    const arrow = after.indexOf(" -> ");
    out.push(arrow !== -1 ? after.slice(arrow + 4) : after);
  }
  return out;
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
