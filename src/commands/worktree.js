/**
 * `kj worktree start|list|done` (KJC-TSK-0679) — isolated lanes for the
 * host agent. Field case: the playbook said "one worktree per task" and an
 * agent NARRATED the isolation while editing the project root. Ordering a
 * command beats ordering a practice: start = worktree + feat/ branch +
 * dependency bootstrap + the exact cd printed; done = remove after merge
 * and delete the branch once it is merged into origin/<base>.
 * Same lane dir (.kj/worktrees) and bootstrap the headless pipeline uses.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bootstrapWorktree } from "../hu/worktree-bootstrap.js";
import { laneWork, setupLane } from "../hu/lane-setup.js";
import { classifyLanes, commitsNotIn, liveProcesses, looseLaneBranches, resolveBase, stopLaneIndexers } from "../hu/lane-prune.js";
import { stopBootstrap } from "../rag/bootstrap-index.js";
import { recordGateDecision } from "../policy/decisions.js";
import { mainCheckout } from "../utils/main-checkout.js";
import { cardsOfLane, parseLanes, prsByBranch } from "../hu/lanes.js";
import { listPlans, loadPlan } from "../plan/plan-store.js";

// The pid itself, not the marker's expiry: an indexer past MAX_RUN_MS still runs. EPERM is a process too.
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };

const REF_SEPARATOR =" · "; // external_ref joins a tracker card and an issue (src/commands/hu.js)

// KJC-TSK-1316: ONE gh call for every lane, open and merged PRs alike.
const listPrs = async (cwd) => JSON.parse((await execFileAsync("gh", ["pr", "list", "--state", "all", "--limit", "200", "--json", "number,url,state,headRefName"], { cwd })).stdout);

/** Each branch's PR; when gh fails the lanes go without PRs, and kj says so. */
async function lanePrs(list, cwd) {
  try {
    return prsByBranch(await list(cwd));
  } catch (err) {
    console.warn(`! kj worktree list: cannot read the PRs (${String(err.stderr || err.message).trim().split("\n")[0]}); lanes listed without them`);
    return new Map();
  }
}

/** Every HU of the project's plans with its references, as `{id, refs}`. */
async function planCards(projectDir) {
  const plans = await Promise.all((await listPlans(projectDir)).map((m) => loadPlan(projectDir, m.planId)));
  return plans.flatMap((p) => (p?.hus ?? []).map((h) => ({ id: h.id, refs: String(h.external_ref ?? "").split(REF_SEPARATOR).filter(Boolean) })));
}

const execFileAsync = promisify(execFile);
const WORKTREE_DIR = ".kj/worktrees"; // shared with the headless lanes

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function worktreeCommand({ config = null, action, args = [], flags = {}, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const git = (gitArgs, cwd = projectDir) => execFileAsync("git", gitArgs, { cwd });
  // #2566: lanes hang from the main checkout, never from the lane the command runs in.
  const lanesDir = path.join(mainCheckout(projectDir), WORKTREE_DIR);
  const lanePath = (slug) => path.join(lanesDir, slug);
  const baseName = config?.base_branch || "main";

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
    // HU-2761: a lane is cut from origin/<base>, never from the HEAD the command runs in (#2566).
    const from = await resolveBase({ git, base: baseName });
    try { await git(["rev-parse", "--verify", "--quiet", `${from}^{commit}`]); } catch {
      throw new Error(`base "${baseName}" not found — set base_branch in kj config`);
    }
    if (from === baseName) {
      console.warn(`! no origin/${baseName} ref — lane starts from local ${baseName}, which may lag (git fetch origin ${baseName} to refresh)`);
    }
    const leftover = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
    if (leftover) {
      throw new Error(`branch ${branch} already exists (kept by an unmerged done?) — delete it with git branch -D ${branch} or pick another slug`);
    }
    // KJC-TSK-1093: --no-track, so no upstream lands in .git/config (read-only in the host sandbox).
    await git(["worktree", "add", "--no-track", "-b", branch, wtPath, from]);
    const boot = await bootstrapWorktree({ worktreePath: wtPath, setupCommand: config?.session?.worktree_setup || null });
    // KJC-TSK-1371 (#2852): identity and Sentinel in the lane; a failure names the step and the way out.
    const retire = `kj worktree done ${slug} --force`;
    const setup = await (deps.setupLane ?? setupLane)({ mainDir: mainCheckout(projectDir), lanePath: wtPath }).catch((err) => {
      throw new Error(`${err.message} — the lane is half set; retire it with: ${retire}`, { cause: err });
    });
    const { stdout: touched } = await git(["status", "--porcelain", "--untracked-files=no"], wtPath);
    if (touched.trim()) throw new Error(`lane setup changed tracked files (${touched.trim().split("\n").join(", ")}) — retire it with: ${retire}`);
    console.log(`✓ lane ready: ${branch} (from ${from})`);
    console.log(`  cd ${wtPath}`);
    console.log("  The gates travel with the repo — kj review --staged works there. When merged: kj worktree done " + slug);
    return { path: wtPath, branch, from, bootstrap: boot, setup };
  }

  if (action === "list") {
    const { stdout } = await git(["worktree", "list", "--porcelain"]);
    const rows = parseLanes(stdout, { root: lanesDir });
    if (flags.json) {
      // KJC-TSK-1313: what the HU Board paints on each card.
      const base = await resolveBase({ git, base: baseName });
      const cards = await planCards(projectDir);
      const prs = flags.prs ? await lanePrs(deps.listPrs ?? listPrs, projectDir) : null;
      const out = await Promise.all(rows.map(async (r) => ({
        ...r, ahead: await commitsNotIn({ git, base, ref: r.branch }).catch(() => null), cards: cardsOfLane(r, cards),
        ...(prs && { pr: prs.get(r.branch) ?? null }),
      })));
      console.log(JSON.stringify(out));
      return out;
    }
    if (rows.length === 0) console.log("no lanes — create one with: kj worktree start <slug>");
    for (const r of rows) console.log(`${r.slug.padEnd(24)} ${r.branch.padEnd(30)} ${r.path}`);
    return rows;
  }

  if (action === "done") {
    const slug = String(args[0] || "").trim();
    const wtPath = lanePath(slug);
    if (!fs.existsSync(wtPath)) throw new Error(`lane "${slug}" not found — see kj worktree list`);
    // KJC-TSK-1371: the identity and Sentinel files lane setup wrote are not the lane's work.
    const { stdout: status } = await git(["status", "--porcelain", "--untracked-files=all"], wtPath);
    const dirty = laneWork(status, wtPath).join("\n");
    if (dirty && !flags.force) {
      throw new Error(`lane "${slug}" has uncommitted changes — commit them (through the gate) or discard with --force`);
    }
    // HU-3114: the lane's background indexer must not outlive it (any age); a failure never blocks the removal.
    const stopIndexer = deps.stopBootstrap ?? (await import("../rag/bootstrap-index.js")).stopBootstrap;
    const indexerStopped = await stopIndexer(wtPath, { force: true }).catch((err) => {
      console.warn(`warning: could not stop the background indexer of "${slug}": ${err.message}`);
      return null;
    });
    // The lane's real branch (headless kj-hu-* lanes share the folder); detached HEAD → null.
    // symbolic-ref -q exits 1 on a detached HEAD; any other failure is a real error.
    const branch = await git(["symbolic-ref", "--short", "-q", "HEAD"], wtPath).then((r) => r.stdout.trim() || null, (err) => {
      if (err.code === 1) return null;
      throw err;
    });
    const base = await resolveBase({ git, base: baseName });
    // A missing base must not block removing a clean lane: the branch is kept, with its remedy.
    const ahead = branch ? await commitsNotIn({ git, base, ref: branch }).catch(() => null) : 0;
    // Only setup files left (checked above): git still calls them untracked, so the remove is forced.
    await git(["worktree", "remove", ...(flags.force || status.trim() ? ["--force"] : []), wtPath]);
    // -D after our own check: -d measures against HEAD/upstream, not origin/<base>. Never the base itself.
    const branchDeleted = Boolean(branch) && branch !== baseName && (ahead === 0 || Boolean(flags.force));
    if (branchDeleted) await git(["branch", "-D", branch]);
    const note = !branch ? "detached HEAD, no branch"
      : branchDeleted ? (ahead === 0 ? `branch ${branch} deleted (merged into ${base})` : `branch ${branch} deleted with --force (${ahead ?? "unknown"} commit(s) not in ${base} were discarded)`)
        : ahead === null ? `branch ${branch} kept: base "${base}" not found, cannot tell if it is merged (git branch -D ${branch} to delete it)`
          : `branch ${branch} kept: ${ahead} commit(s) not in ${base} (squash-merged or not fetched? git fetch, then git branch -D ${branch})`;
    console.log(`✓ lane "${slug}" removed; ${note}`);
    return { removed: true, slug, branch, branchDeleted, merged: branch ? ahead === 0 : null, indexerStopped };
  }

  if (action === "prune") {
    const { processes = liveProcesses() } = deps;
    const base = await resolveBase({ git, base: baseName });
    const lanes = await classifyLanes({ git, laneRoot: lanesDir, base, processes, now: deps.now });
    // HU-3092: a removable lane's own background indexer is stopped first (never in a dry run); one that survives keeps the lane.
    if (!flags.dryRun) await stopLaneIndexers(lanes, { stop: deps.stopIndexer ?? ((l) => stopBootstrap(l.path, { force: true })), stillRunning: deps.indexerRunning ?? ((l) => pidAlive(l.indexer.pid)) });
    const abandoned = lanes.filter((l) => l.reasons.length === 0);
    const kept = lanes.filter((l) => l.reasons.length > 0);
    for (const l of kept) console.log(`kept    ${l.slug.padEnd(24)} ${l.reasons.join("; ")}`);
    if (lanes.length === 0) console.log("no kj lanes");
    // KJC-TSK-1037: loose kj-hu-* branches of old runs, measured against the same base.
    const { empty: branches, withWork } = await looseLaneBranches({ git, base });
    for (const b of withWork) console.log(`kept    branch ${b.branch.padEnd(17)} ${b.reason}`);
    if (flags.dryRun) {
      for (const l of abandoned) console.log(`would retire ${l.slug} (${l.branch ?? "detached"})${l.indexer ? ` (stopping its background index, pid ${l.indexer.pid})` : ""}`);
      for (const b of branches) console.log(`would delete branch ${b}`);
      return { wouldRemove: abandoned, kept, wouldRemoveBranches: branches, branchesKept: withWork };
    }
    for (const b of branches) {
      await git(["branch", "-D", b]);
      console.log(`✓ deleted branch ${b}`);
    }
    for (const l of abandoned) {
      // Judged abandoned above: what is left are setup or regenerable files, which git would refuse.
      await git(["worktree", "remove", "--force", l.path]);
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
