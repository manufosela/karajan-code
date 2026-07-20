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

/**
 * List commits in the range `fromSha..toRef`. Used by the post-loop
 * journal builder to enumerate every commit produced during a `kj run`
 * — both the coder's own commits AND the post-loop scaffold commit —
 * so the user-visible summary doesn't lose track of them. Pre-fix the
 * summary only listed `gitResult.commits` (post-loop only), which made
 * `kj run "..."` runs look like the coder hadn't committed.
 *
 * Returns oldest-first so the list reads in execution order.
 *
 * @param {string|null|undefined} fromSha The SHA right BEFORE the run started
 *   (typically `session.session_start_sha`). Empty/missing → returns [].
 * @param {string} [toRef="HEAD"]
 * @returns {Promise<Array<{hash: string, message: string}>>}
 */
/**
 * List the file paths changed in the range `fromSha..toRef`. Used by the
 * plan-adherence metric (KJC-TSK-0376) to score whether the coder's
 * file changes fall within any HU's declared scope.
 *
 * Returns a deduplicated array of file paths, oldest commit's files
 * first. Defensive: returns [] on missing `fromSha`, non-zero git exit,
 * or thrown error — consistent with `listCommitsBetween`'s contract.
 *
 * @param {string|null|undefined} fromSha
 * @param {string} [toRef="HEAD"]
 * @returns {Promise<string[]>}
 */
export async function listFilesChangedSince(fromSha, toRef = "HEAD") {
  if (!fromSha) return [];
  const result = await run(
    "git",
    ["diff", "--name-only", `${fromSha}..${toRef}`],
  ).catch(() => null);
  if (!result || result.exitCode !== 0) return [];
  const lines = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines));
}

export async function listCommitsBetween(fromSha, toRef = "HEAD") {
  if (!fromSha) return [];
  const result = await run(
    "git",
    ["log", "--reverse", "--format=%H%x09%s", `${fromSha}..${toRef}`],
  ).catch(() => null);
  if (!result || result.exitCode !== 0) return [];
  return String(result.stdout || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      // Defensive: if git emitted no tab (shouldn't happen with our format)
      // treat the whole line as the hash and leave the message empty rather
      // than throw — caller can still render the row.
      if (tabIdx === -1) return { hash: line, message: "" };
      return { hash: line.slice(0, tabIdx), message: line.slice(tabIdx + 1) };
    });
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

export async function hasChanges(cwd = null) {
  const status = await runGit(["status", "--porcelain"], cwd ? { cwd } : {});
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

// Locale-tolerant detection of "git commit refused because the working
// tree was already clean by the time we ran it". Observed in N4
// dogfooding (2026-05-07) — `hasChanges()` reported true after `add -A`
// but `git commit` then failed with the Spanish message "nada para hacer
// commit, el árbol de trabajo está limpio". The race window is real:
// post-loop journal writes can finish between hasChanges and commit, and
// some files come back from `add -A` with no diff vs HEAD even though
// they show up in `git status --porcelain`. We treat any of those as
// "no commit needed" rather than escalating to Solomon.
const NOTHING_TO_COMMIT_PATTERNS = [
  /nothing to commit/i,
  /nada para hacer commit/i,         // git in es_ES locale
  /no hay nada para confirmar/i,     // git in es_ES alt phrasing
  /aucune modification ajout[ée]e au commit/i, // fr_FR
  /nichts zu committen/i,            // de_DE
];
function isNothingToCommit(message) {
  const m = String(message || "");
  return NOTHING_TO_COMMIT_PATTERNS.some((re) => re.test(m));
}

export async function commitAll(message, cwd = null, { beforeCommit = null } = {}) {
  const opts = cwd ? { cwd } : {};
  await runGit(["add", "-A"], opts);
  const changed = await hasChanges(cwd);
  if (!changed) return { committed: false };
  // ENV-F1 (KJC-TSK-0643): runs between staging and committing — the only
  // window where the staged diff is exactly what the commit will contain
  // (used to stamp the pipeline's review verdict for the v4 gate).
  if (beforeCommit) await beforeCommit();
  try {
    await runGit(["commit", "-m", message], opts);
  } catch (err) {
    // `git status --porcelain` and `git commit` disagreed about whether
    // there was anything to commit. Don't escalate — the only outcome
    // either way is "no new commit was created", which the caller
    // already handles via committed=false.
    if (isNothingToCommit(err?.message)) {
      return { committed: false };
    }
    throw err;
  }
  const raw = await runGit(["log", "-1", "--pretty=format:%H%x1f%s"], opts);
  const [hash, commitMessage] = raw.split("\x1f");
  return { committed: true, commit: { hash, message: commitMessage } };
}

/**
 * KJC-BUG-0112: whether the repo has an `origin` remote. The quickstart
 * scenario (fresh folder + git init) has none — post-approval push/PR
 * automation must skip instead of failing and escalating to Solomon.
 */
export async function hasRemote(cwd = null) {
  const res = await run("git", ["remote", "get-url", "origin"], cwd ? { cwd } : {});
  return res.exitCode === 0;
}

export async function pushBranch(branch, cwd = null) {
  await runGit(["push", "-u", "origin", branch], cwd ? { cwd } : {});
}

export async function createPullRequest({ baseBranch, branch, title, body, cwd = null }) {
  const args = ["pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body", body];
  const res = await runCommand("gh", args, cwd ? { cwd } : {});
  if (res.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}
