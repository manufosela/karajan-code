import { runCommand } from "../utils/process.js";
import { generateSnapshotDiff } from "./snapshot-diff.js";
import { getRunContext } from "../utils/run-context.js";

// Module-scope back-compat state for callers outside a `withRunContext`
// scope. When inside a pipeline, `getRunContext()` provides per-run
// isolation (TSK-0338) — the module-level values below are only consulted
// as a last resort.

/** @type {((command: string, args?: string[], options?: object) => Promise<object>)|null} */
let _runner = null;

/** @type {Map<string, string>|null} — pre-coder filesystem snapshot for git-free diff */
let _snapshot = null;

/** @type {string|null} — project directory scope for git diff (prevents leaking unrelated changes) */
let _projectDir = null;

/** Retained for back-compat; pipelines should use `withRunContext({ projectDir })` for isolation. */
export function setProjectDir(dir) {
  _projectDir = dir;
}

/** Retained for back-compat; pipelines should use `withRunContext({ snapshot })` for isolation. */
export function setSnapshot(snapshot) {
  _snapshot = snapshot;
}

/** Retained for back-compat; pipelines should use `withRunContext({ runner })` for isolation. */
export function setRunner(runner) {
  _runner = runner;
}

function resolveRunner() {
  return getRunContext()?.runner || _runner || runCommand;
}

function resolveProjectDir() {
  const ctx = getRunContext();
  if (ctx && "projectDir" in ctx) return ctx.projectDir;
  return _projectDir;
}

function resolveSnapshot() {
  const ctx = getRunContext();
  if (ctx && "snapshot" in ctx) return ctx.snapshot;
  return _snapshot;
}

function run(command, args, ...rest) {
  return resolveRunner()(command, args, ...rest);
}

export async function computeBaseRef({ baseBranch = "main", baseRef = null }) {
  if (baseRef) return baseRef;

  try {
    const mergeBase = await run("git", ["merge-base", "HEAD", `origin/${baseBranch}`]);
    if (mergeBase.exitCode === 0) return mergeBase.stdout.trim();

    const fallback = await run("git", ["rev-parse", "HEAD~1"]);
    if (fallback.exitCode === 0) return fallback.stdout.trim();

    // Empty repo (zero commits): diff against the empty tree
    const emptyTree = await run("git", ["hash-object", "-t", "tree", "/dev/null"]);
    if (emptyTree.exitCode === 0) return emptyTree.stdout.trim();
  } catch { /* git not available */ }

  // No git or all strategies failed — return sentinel for snapshot-based diff
  return "__snapshot__";
}

export async function generateDiff({ baseRef, stageNewFiles = false, projectDir = null }) {
  // Auto-resolve projectDir from run context (TSK-0338) or module fallback
  const scopeDir = projectDir || resolveProjectDir() || null;
  const snapshot = resolveSnapshot();

  // Try git diff first
  try {
    if (stageNewFiles) {
      const addArgs = scopeDir ? ["-A", scopeDir] : ["-A"];
      await run("git", ["add", ...addArgs]);
    }
    const diffArgs = ["diff", stageNewFiles ? "--cached" : "", `${baseRef}`].filter(Boolean);
    // Scope diff to projectDir when it's a subdirectory (prevents leaking unrelated changes)
    if (scopeDir) diffArgs.push("--", scopeDir);
    const result = await run("git", diffArgs);
    if (result.exitCode === 0) {
      return result.stdout;
    }
  } catch { /* git not available or failed */ }

  // Fallback: snapshot-based diff (no git needed)
  if (snapshot) {
    const dir = projectDir || process.cwd();
    return generateSnapshotDiff(snapshot, null, dir);
  }

  // No git and no snapshot — generate diff of all files as new.
  // TSK-0340: dropped a stray `const { takeSnapshot } = await import(...)`
  // that was never used in this branch (we synthesize an empty Map and
  // let generateSnapshotDiff do the file walk itself).
  const dir = projectDir || process.cwd();
  const emptySnapshot = new Map();
  return generateSnapshotDiff(emptySnapshot, null, dir);
}

export async function getUntrackedFiles(cwd = null) {
  const result = await run("git", ["ls-files", "--others", "--exclude-standard"], cwd ? { cwd } : {});
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}
