/**
 * KJC-TSK-1036 (owner's decision, 14-oct): a lane kj created is retired only when
 * it is provably abandoned: clean tree, no commits beyond the base, and no live
 * process working inside it. Anything else is listed with its reason, never
 * touched, so a session may run this without risking anyone's work.
 */
import fs from "node:fs";
import path from "node:path";
import { laneWork } from "./lane-setup.js";

const IDLE_HOURS = 24;
const REGENERABLE = new Set(["node_modules", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".cache", "target"]);

/**
 * This user's live processes (another user's cannot write in our worktrees): the
 * cwds that can be read and how many cannot (non-dumpable ones: ssh-agent, systemd,
 * some JVMs). null when the platform has no /proc.
 */
export function liveProcesses() {
  let pids;
  try { pids = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)); } catch { return null; }
  const cwds = new Set();
  let unseen = 0;
  for (const pid of pids) {
    try {
      if (fs.statSync(`/proc/${pid}`).uid !== process.getuid()) continue;
      cwds.add(fs.readlinkSync(`/proc/${pid}/cwd`));
    } catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ESRCH") unseen += 1;
    }
  }
  return { cwds, unseen };
}

/** Hours since anything in the lane moved: its dir, and its git index and HEAD. */
async function idleHours(git, lanePath, now) {
  const { stdout } = await git(["rev-parse", "--absolute-git-dir"], lanePath);
  const gitDir = stdout.trim();
  const times = [lanePath, path.join(gitDir, "index"), path.join(gitDir, "HEAD")]
    .map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
  return (now - Math.max(...times)) / 3_600_000;
}

const inside = (cwd, dir) => cwd === dir || cwd.startsWith(dir + path.sep);

/** @returns {Promise<{slug: string, path: string, branch: string|null, reasons: string[]}[]>} */
export async function classifyLanes({ git, laneRoot, base, processes, now = Date.now() }) {
  const { stdout } = await git(["worktree", "list", "--porcelain"]);
  const lanes = [];
  let current = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9).trim(), branch: null };
      if (current.path.startsWith(laneRoot + path.sep)) lanes.push(current);
    } else if (line.startsWith("branch ") && current) current.branch = line.slice(7).trim().replace("refs/heads/", "");
  }
  return Promise.all(lanes.map(async (lane) => {
    const reasons = [];
    // KJC-TSK-1371: the identity and Sentinel files lane setup wrote are not the lane's work.
    const { stdout: status } = await git(["status", "--porcelain", "--ignored=matching", "--untracked-files=all"], lane.path);
    const entries = laneWork(status, lane.path);
    if (entries.some((e) => !e.startsWith("!! "))) reasons.push("uncommitted changes");
    // Ignored files can be valuable (.env, local artifacts); only regenerable dirs are not.
    const precious = entries.filter((e) => e.startsWith("!! ") && !REGENERABLE.has(e.slice(3).split("/")[0]));
    if (precious.length > 0) reasons.push(`ignored files that are not regenerable (${precious[0].slice(3)}${precious.length > 1 ? ", …" : ""})`);
    // The lane's HEAD, branch or detached: a detached lane's commits have no other name.
    const ahead = await commitsNotIn({ git, base, cwd: lane.path });
    if (ahead > 0) reasons.push(`${ahead} commit(s) not in ${base}`);
    if (processes === null) reasons.push("cannot check for live processes on this platform");
    else if ([...processes.cwds].some((cwd) => inside(cwd, lane.path))) reasons.push("a live process works in it");
    else if (processes.unseen > 0 && (await idleHours(git, lane.path, now)) < IDLE_HOURS) {
      reasons.push(`${processes.unseen} process(es) of yours cannot be inspected and the lane changed in the last ${IDLE_HOURS} h`);
    }
    return { slug: path.basename(lane.path), path: lane.path, branch: lane.branch, reasons };
  }));
}

/** KJC-TSK-1037: the base a lane is measured against: origin/<base> when it exists (a local base can lag far behind). */
export async function resolveBase({ git, base }) {
  try {
    await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]);
    return `origin/${base}`;
  } catch {
    return base;
  }
}

/** Commits of `ref` (default HEAD, run in `cwd`) that `base` lacks; 0 means merged. */
export async function commitsNotIn({ git, base, ref = "HEAD", cwd }) {
  const { stdout } = await git(["rev-list", "--count", `${base}..${ref}`], cwd);
  return Number(stdout);
}

/** KJC-TSK-1037: loose kj-hu-* branches (no worktree): the empty ones, and the ones with work and how much. */
export async function looseLaneBranches({ git, base }) {
  const { stdout: listed } = await git(["for-each-ref", "--format=%(refname:short) %(worktreepath)", "refs/heads/kj-hu-*"]);
  const loose = listed.split("\n").map((l) => l.trim()).filter((l) => l && !l.includes(" "));
  const empty = [];
  const withWork = [];
  for (const branch of loose) {
    const ahead = await commitsNotIn({ git, base, ref: branch });
    if (ahead === 0) empty.push(branch);
    else withWork.push({ branch, reason: `${ahead} commit(s) not in ${base}` });
  }
  return { empty, withWork };
}
