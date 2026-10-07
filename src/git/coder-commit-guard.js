/**
 * KJC-BUG-0285 (#1982): the coder commits nothing; the pipeline does, once the
 * review approves. With --auto-commit the coder ran git commit inside its
 * iteration, before the reviewer, and the rejected commit stayed on the branch.
 * The stage reads HEAD before the coder runs and, when HEAD moved on top of it,
 * undoes those commits SOFTLY: the changes stay in the tree and the index for
 * the review. A rewritten branch (HEAD no longer descends from the start) is
 * left alone. Plain git, no injected runner: it never throws, it says.
 */
import { spawnSync } from "node:child_process";

const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** @returns {string|null} the sha HEAD points at, or null outside a repo with commits */
export function headSha(cwd = process.cwd()) {
  try {
    const res = git(["rev-parse", "HEAD"], cwd);
    return res.status === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** @returns {{undone: number, reason?: string}} */
export function undoCommitsSince(sha, cwd = process.cwd()) {
  if (!sha) return { undone: 0, reason: "no starting commit" };
  try {
    const head = headSha(cwd);
    if (!head || head === sha) return { undone: 0 };
    if (git(["merge-base", "--is-ancestor", sha, "HEAD"], cwd).status !== 0) {
      return { undone: 0, reason: "HEAD no longer descends from the iteration's start" };
    }
    const undone = Number(git(["rev-list", "--count", `${sha}..HEAD`], cwd).stdout.trim());
    const reset = git(["reset", "--soft", sha], cwd);
    if (reset.status !== 0) return { undone: 0, reason: `git reset --soft failed: ${reset.stderr.trim()}` };
    return { undone };
  } catch (err) {
    return { undone: 0, reason: err.message };
  }
}
