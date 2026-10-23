/**
 * KJC-BUG-0391: "Update branch" puts a merge of the base on top of a PR. A
 * clean merge brings no work of the PR: its tree is exactly what git merges
 * from its parents, so it needs no cross-AI verdict. A merge whose tree differs
 * (conflicts resolved by hand, or anything slipped in) is work and still needs
 * one. Exit codes only, never git's messages, which follow the user's language.
 */
import { runCommand } from "../utils/process.js";

/** True when `sha` is a merge whose tree is the clean merge of its two parents. */
export async function isCleanMerge(projectDir, sha, run = runCommand) {
  const git = (...args) => run("git", ["-C", projectDir, ...args]);
  const parents = await git("rev-list", "--parents", "-n", "1", sha);
  if (parents.exitCode !== 0) throw new Error(`git rev-list ${sha.slice(0, 7)} failed: ${(parents.stderr || "").trim()}`);
  const ids = parents.stdout.trim().split(/\s+/).slice(1);
  if (ids.length !== 2) return false;
  // Exit 1 means conflicts: the merge commit then holds a resolution, which is work.
  const merged = await git("merge-tree", "--write-tree", ...ids);
  if (merged.exitCode !== 0) return false;
  const tree = await git("rev-parse", `${sha}^{tree}`);
  if (tree.exitCode !== 0) throw new Error(`git rev-parse ${sha.slice(0, 7)} failed: ${(tree.stderr || "").trim()}`);
  return merged.stdout.trim().split("\n")[0] === tree.stdout.trim();
}
