import { runCommand } from "../utils/process.js";

/** @type {((command: string, args?: string[], options?: object) => Promise<object>)|null} */
let _runner = null;

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
  const mergeBase = await run("git", ["merge-base", "HEAD", `origin/${baseBranch}`]);
  if (mergeBase.exitCode !== 0) {
    const fallback = await run("git", ["rev-parse", "HEAD~1"]);
    if (fallback.exitCode !== 0) {
      throw new Error("Could not compute diff base reference");
    }
    return fallback.stdout.trim();
  }
  return mergeBase.stdout.trim();
}

export async function generateDiff({ baseRef, stageNewFiles = false }) {
  // Stage untracked files so they appear in the diff (coder creates files but doesn't git add)
  if (stageNewFiles) {
    await run("git", ["add", "-A"]);
  }
  const result = await run("git", ["diff", stageNewFiles ? "--cached" : "", `${baseRef}`].filter(Boolean));
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export async function getUntrackedFiles() {
  const result = await run("git", ["ls-files", "--others", "--exclude-standard"]);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}
