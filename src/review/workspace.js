/**
 * Workspace detection for the review gate (KJC-TSK-0680). Field case: an
 * agent claimed worktree isolation while editing the project root. The
 * verdict now stamps WHERE the review actually ran, using the same proof
 * the playbook demands: in a linked worktree, `git rev-parse --git-dir`
 * differs from `--git-common-dir`. "root" | "worktree:<name>" | null
 * (not a git repo — the gate itself will fail later with its own error).
 */
import path from "node:path";
import { runCommand } from "../utils/process.js";

export async function detectWorkspace(dir) {
  const res = await runCommand("git", ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"], { cwd: dir });
  if (res.exitCode !== 0) return null;
  const [gitDir, commonDir, toplevel] = String(res.stdout).trim().split("\n").map((l) => l.trim());
  if (!gitDir || !commonDir) return null;
  const resolvedGit = path.resolve(dir, gitDir);
  const resolvedCommon = path.resolve(dir, commonDir);
  if (resolvedGit === resolvedCommon) return "root";
  return `worktree:${path.basename(toplevel || dir)}`;
}
