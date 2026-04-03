import { runCommand } from "../utils/process.js";
import { generateSnapshotDiff } from "./snapshot-diff.js";

/** @type {((command: string, args?: string[], options?: object) => Promise<object>)|null} */
let _runner = null;

/** @type {Map<string, string>|null} — pre-coder filesystem snapshot for git-free diff */
let _snapshot = null;

/** @type {string|null} — project directory scope for git diff (prevents leaking unrelated changes) */
let _projectDir = null;

/**
 * Set the project directory scope. When set, all diffs are scoped to this directory.
 * Call once at pipeline start when projectDir differs from repo root.
 * @param {string|null} dir
 */
export function setProjectDir(dir) {
  _projectDir = dir;
}

/**
 * Store a filesystem snapshot for git-free diff fallback.
 * Call before the coder runs. If git is available, this is unused.
 * @param {Map<string, string>} snapshot
 */
export function setSnapshot(snapshot) {
  _snapshot = snapshot;
}

/**
 * Inject an RTK-aware runner so all git operations in this module benefit from token savings.
 * Call once at pipeline start when RTK is available.
 * @param {(command: string, args?: string[], options?: object) => Promise<object>} runner
 */
export function setRunner(runner) {
  _runner = runner;
}

function run(command, args, ...rest) {
  return (_runner || runCommand)(command, args, ...rest);
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
  // Auto-resolve projectDir from config if not passed explicitly
  const scopeDir = projectDir || _projectDir || null;

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
  if (_snapshot) {
    const dir = projectDir || process.cwd();
    return generateSnapshotDiff(_snapshot, null, dir);
  }

  // No git and no snapshot — generate diff of all files as new
  const dir = projectDir || process.cwd();
  const { takeSnapshot } = await import("./snapshot-diff.js");
  const emptySnapshot = new Map();
  return generateSnapshotDiff(emptySnapshot, null, dir);
}

export async function getUntrackedFiles() {
  const result = await run("git", ["ls-files", "--others", "--exclude-standard"]);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}
