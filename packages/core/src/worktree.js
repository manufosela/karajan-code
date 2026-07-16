/**
 * worktree — git worktree lifecycle for parallel HU execution (KJC-TSK-0622,
 * épica KJC-PCS-0065). Each concurrent HU runs in its own worktree under
 * .karajan/worktrees/<id> with its own branch, so coders never stomp each
 * other's working tree. Failures are loud: every helper throws with git's
 * stderr — a half-created worktree must never pass silently.
 */

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { runCommand } from "./process.js";

/** Root directory that owns every kj-managed worktree of a project. */
export function worktreesRoot(projectDir) {
  return join(projectDir, ".karajan", "worktrees");
}

async function git(projectDir, args) {
  const res = await runCommand("git", args, { cwd: projectDir });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
  }
  return res.stdout ?? "";
}

/**
 * Create a worktree for `id` with a new `branch` cut from `baseRef`.
 * Returns { dir, branch }. Throws if the target already exists — the caller
 * decides whether a leftover is an orphan to clean or a live run.
 */
export async function createWorktree({ projectDir, id, branch, baseRef = "HEAD" }) {
  const dir = join(worktreesRoot(projectDir), id);
  if (existsSync(dir)) throw new Error(`worktree already exists: ${dir}`);
  await git(projectDir, ["worktree", "add", "-b", branch, dir, baseRef]);
  return { dir, branch };
}

/** Remove the worktree for `id`. `force` discards uncommitted changes. */
export async function removeWorktree({ projectDir, id, force = false }) {
  const dir = join(worktreesRoot(projectDir), id);
  await git(projectDir, ["worktree", "remove", ...(force ? ["--force"] : []), dir]);
}

/**
 * List kj-managed worktrees (those under worktreesRoot) as
 * [{ id, dir, branch, head }], parsed from `git worktree list --porcelain`.
 */
export async function listWorktrees(projectDir) {
  const out = await git(projectDir, ["worktree", "list", "--porcelain"]);
  const root = resolve(worktreesRoot(projectDir));
  const entries = [];
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { dir: line.slice("worktree ".length), branch: null, head: null };
      entries.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  return entries
    .filter((e) => resolve(e.dir).startsWith(root + "/") || resolve(e.dir) === root)
    .map((e) => ({ ...e, id: resolve(e.dir).slice(root.length + 1) }));
}

/**
 * Clean up worktrees left behind by dead runs: everything under
 * worktreesRoot whose id is not in `keep`, plus `git worktree prune` for
 * entries whose directory already vanished. Returns the removed ids.
 */
export async function cleanupOrphans(projectDir, { keep = [] } = {}) {
  await git(projectDir, ["worktree", "prune"]);
  const removed = [];
  for (const wt of await listWorktrees(projectDir)) {
    if (keep.includes(wt.id)) continue;
    try {
      await removeWorktree({ projectDir, id: wt.id, force: true });
    } catch {
      // Directory gone but registered, or locked — prune again and drop the dir.
      await git(projectDir, ["worktree", "prune"]);
      rmSync(wt.dir, { recursive: true, force: true });
    }
    removed.push(wt.id);
  }
  return removed;
}
