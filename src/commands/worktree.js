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
import { classifyLanes, liveProcesses, looseLaneBranches, resolveBase } from "../hu/lane-prune.js";
import { recordGateDecision } from "../policy/decisions.js";
import { mainCheckout } from "../utils/main-checkout.js";

const execFileAsync = promisify(execFile);
const WORKTREE_DIR = ".kj/worktrees"; // shared with the headless lanes

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function worktreeCommand({ config = null, action, args = [], flags = {}, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const git = (gitArgs, cwd = projectDir) => execFileAsync("git", gitArgs, { cwd });
  // #2566: lanes hang from the main checkout, never from the lane the command runs in.
  const lanesDir = path.join(mainCheckout(projectDir), WORKTREE_DIR);
  const lanePath = (slug) => path.join(lanesDir, slug);

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
    // KJC-TSK-1093: --no-track, so no upstream lands in .git/config (read-only in the host sandbox).
    await git(["worktree", "add", "--no-track", "-b", branch, wtPath]);
    const boot = await bootstrapWorktree({ worktreePath: wtPath, setupCommand: config?.session?.worktree_setup || null });
    console.log(`✓ lane ready: ${branch}`);
    console.log(`  cd ${wtPath}`);
    console.log("  The gates travel with the repo — kj review --staged works there. When merged: kj worktree done " + slug);
    return { path: wtPath, branch, bootstrap: boot };
  }

  if (action === "list") {
    const laneRoot = lanesDir + path.sep;
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

  if (action === "prune") {
    const { processes = liveProcesses() } = deps;
    const base = await resolveBase({ git, base: config?.base_branch || "main" });
    const lanes = await classifyLanes({ git, laneRoot: lanesDir, base, processes, now: deps.now });
    const abandoned = lanes.filter((l) => l.reasons.length === 0);
    const kept = lanes.filter((l) => l.reasons.length > 0);
    for (const l of kept) console.log(`kept    ${l.slug.padEnd(24)} ${l.reasons.join("; ")}`);
    if (lanes.length === 0) console.log("no kj lanes");
    // KJC-TSK-1037: loose kj-hu-* branches of old runs, measured against the same base.
    const { empty: branches, withWork } = await looseLaneBranches({ git, base });
    for (const b of withWork) console.log(`kept    branch ${b.branch.padEnd(17)} ${b.reason}`);
    if (flags.dryRun) {
      for (const l of abandoned) console.log(`would retire ${l.slug} (${l.branch ?? "detached"})`);
      for (const b of branches) console.log(`would delete branch ${b}`);
      return { wouldRemove: abandoned, kept, wouldRemoveBranches: branches, branchesKept: withWork };
    }
    for (const b of branches) {
      await git(["branch", "-D", b]);
      console.log(`✓ deleted branch ${b}`);
    }
    for (const l of abandoned) {
      await git(["worktree", "remove", l.path]);
      if (l.branch) await git(["branch", "-D", l.branch]);
      console.log(`✓ retired ${l.slug} (${l.branch ?? "detached"})`);
    }
    if (abandoned.length > 0 || branches.length > 0) {
      recordGateDecision(projectDir, { decision: "allow", chokepoint: "tool", kind: "worktree-prune", lanes: abandoned.map((l) => l.slug), branches });
    }
    return { removed: abandoned, kept, branchesRemoved: branches, branchesKept: withWork };
  }

  throw new Error(`unknown action "${action}" — use: start | list | done | prune`);
}
