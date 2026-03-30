/**
 * Parallel HU execution using git worktrees.
 *
 * Analyses the dependency graph to find groups of HUs that can run
 * concurrently, creates isolated git worktrees for each parallel HU,
 * and merges results back sequentially.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** Directory inside the project where worktrees are created. */
const WORKTREE_DIR = ".kj/worktrees";

/**
 * Given stories and their topological order, return groups (batches) of HUs
 * that can execute in parallel.  Two HUs can run in parallel when neither
 * depends (directly or transitively) on the other.
 *
 * The algorithm walks the topological order and assigns each HU to the
 * earliest batch where all its dependencies have already been placed in
 * a previous batch.
 *
 * @param {Array<{id: string, blocked_by?: string[]}>} stories
 * @param {string[]} order - topologically sorted story IDs
 * @returns {string[][]} Array of batches; each batch is an array of story IDs.
 */
export function findParallelGroups(stories, order) {
  if (!order.length) return [];

  const storyMap = new Map(stories.map(s => [s.id, s]));
  // batchIndex[id] = index of the batch the story was assigned to
  const batchIndex = new Map();
  const batches = [];

  for (const id of order) {
    const story = storyMap.get(id);
    const deps = story?.blocked_by || [];
    // This HU must go into the batch *after* the latest dependency batch
    let earliest = 0;
    for (const dep of deps) {
      if (batchIndex.has(dep)) {
        earliest = Math.max(earliest, batchIndex.get(dep) + 1);
      }
    }
    if (!batches[earliest]) batches[earliest] = [];
    batches[earliest].push(id);
    batchIndex.set(id, earliest);
  }

  return batches;
}

/**
 * Create a git worktree for a given HU.
 *
 * @param {string} projectDir - Root directory of the git repo.
 * @param {string} huId - Story identifier (used for branch and directory name).
 * @returns {Promise<string>} Absolute path to the created worktree.
 */
export async function createWorktree(projectDir, huId) {
  const worktreePath = path.join(projectDir, WORKTREE_DIR, huId);
  const branchName = `kj-hu-${huId}`;
  await execFileAsync("git", ["worktree", "add", worktreePath, "-b", branchName], { cwd: projectDir });
  return worktreePath;
}

/**
 * Remove a git worktree (forcefully).
 *
 * @param {string} projectDir - Root directory of the git repo.
 * @param {string} huId - Story identifier.
 * @returns {Promise<void>}
 */
export async function removeWorktree(projectDir, huId) {
  const worktreePath = path.join(projectDir, WORKTREE_DIR, huId);
  await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], { cwd: projectDir });
}

/**
 * Merge a worktree branch back into the current branch and clean up.
 *
 * @param {string} projectDir - Root directory of the git repo.
 * @param {string} huId - Story identifier.
 * @returns {Promise<void>}
 */
export async function mergeWorktree(projectDir, huId) {
  const branchName = `kj-hu-${huId}`;
  await execFileAsync("git", ["merge", branchName, "--no-edit"], { cwd: projectDir });
  await removeWorktree(projectDir, huId);
  await execFileAsync("git", ["branch", "-d", branchName], { cwd: projectDir });
}
