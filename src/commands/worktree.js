/**
 * `kj worktree start|list|done` (KJC-TSK-0679) — isolated lanes for the
 * host agent. Field case: the playbook said "one worktree per task" and an
 * agent NARRATED the isolation while editing the project root. Ordering a
 * command beats ordering a practice: start = worktree + feat/ branch +
 * dependency bootstrap + the exact cd printed; done = remove after merge.
 * Same lane dir (.kj/worktrees) and bootstrap the headless pipeline uses.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bootstrapWorktree } from "../hu/worktree-bootstrap.js";

const execFileAsync = promisify(execFile);
const WORKTREE_DIR = ".kj/worktrees"; // shared with the headless lanes

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function worktreeCommand({ config = null, action, args = [], flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const git = (gitArgs, cwd = projectDir) => execFileAsync("git", gitArgs, { cwd });
  const lanePath = (slug) => path.join(projectDir, WORKTREE_DIR, slug);

  if (action === "start") {
    const slug = String(args[0] || "").trim();
    if (!SLUG_RE.test(slug)) {
      throw new Error("invalid slug — use letters, digits, dots, dashes (no slashes): kj worktree start <slug>");
    }
    const wtPath = lanePath(slug);
    if (fs.existsSync(wtPath)) {
      throw new Error(`lane "${slug}" already exists — cd ${wtPath}, or finish it with: kj worktree done ${slug}`);
    }
    const branch = `feat/${slug}`;
    await git(["worktree", "add", "-b", branch, wtPath]);
    const boot = await bootstrapWorktree({ worktreePath: wtPath, setupCommand: config?.session?.worktree_setup || null });
    console.log(`✓ lane ready: ${branch}`);
    console.log(`  cd ${wtPath}`);
    console.log("  The gates travel with the repo — kj review --staged works there. When merged: kj worktree done " + slug);
    return { path: wtPath, branch, bootstrap: boot };
  }

  if (action === "list") {
    const laneRoot = path.join(projectDir, WORKTREE_DIR) + path.sep;
    const { stdout } = await git(["worktree", "list", "--porcelain"]);
    const rows = [];
    let current = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) current = { path: line.slice(9).trim() };
      else if (line.startsWith("branch ") && current) {
        current.branch = line.slice(7).trim().replace("refs/heads/", "");
        if (current.path.startsWith(laneRoot)) {
          rows.push({ slug: path.basename(current.path), branch: current.branch, path: current.path });
        }
      }
    }
    if (rows.length === 0) console.log("no lanes — create one with: kj worktree start <slug>");
    for (const r of rows) console.log(`${r.slug.padEnd(24)} ${r.branch.padEnd(30)} ${r.path}`);
    return rows;
  }

  if (action === "done") {
    const slug = String(args[0] || "").trim();
    const wtPath = lanePath(slug);
    if (!fs.existsSync(wtPath)) throw new Error(`lane "${slug}" not found — see kj worktree list`);
    const { stdout: dirty } = await git(["status", "--porcelain"], wtPath);
    if (dirty.trim() && !flags.force) {
      throw new Error(`lane "${slug}" has uncommitted changes — commit them (through the gate) or discard with --force`);
    }
    await git(["worktree", "remove", ...(flags.force ? ["--force"] : []), wtPath]);
    console.log(`✓ lane "${slug}" removed — its branch survives; delete it after merge if you want`);
    return { removed: true, slug };
  }

  throw new Error(`unknown action "${action}" — use: start | list | done`);
}
