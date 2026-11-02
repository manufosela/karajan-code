/**
 * KJC-TSK-1036 (owner's decision, 14-oct): a lane kj created is retired only when
 * it is provably abandoned: clean tree, no commits beyond the base, and no live
 * process working inside it. Anything else is listed with its reason, never
 * touched, so a session may run this without risking anyone's work.
 */
import fs from "node:fs";
import path from "node:path";
import { isLaneSetupPath, laneWork } from "./lane-setup.js";
import { readBootstrap } from "../rag/bootstrap-index.js";

const IDLE_HOURS = 24;
// HU-3092: the lane's index and what rides along it (-wal, -shm, .bootstrap, .embed-schema) is regenerable state.
const RAG_STATE = /^\.karajan\/rag\.db([.-]|$)/;
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
  const procs = [];
  let unseen = 0;
  for (const pid of pids) {
    try {
      if (fs.statSync(`/proc/${pid}`).uid !== process.getuid()) continue;
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      cwds.add(cwd);
      procs.push({ pid: Number(pid), cwd });
    } catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ESRCH") unseen += 1;
    }
  }
  return { cwds, unseen, procs };
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

/** A folder git lists whole (an ignored `.karajan/`) holds only index state and setup when every file in it does. */
function onlyRagState(lanePath, dir) {
  try {
    return fs.readdirSync(path.join(lanePath, dir), { recursive: true, withFileTypes: true }).filter((d) => !d.isDirectory()) // symlinks and the like are the user's, never state
      .every((d) => { const rel = path.relative(lanePath, path.join(d.parentPath, d.name)); return RAG_STATE.test(rel) || isLaneSetupPath(rel); });
  } catch { return false; }
}
const ragOnly = (lanePath, p) => RAG_STATE.test(p) || (p.endsWith("/") && onlyRagState(lanePath, p));

/**
 * The pid of the lane's background indexer: the one its marker names, while the marker notes no stop.
 * null when KJ_RAG_DB puts the index elsewhere: the marker read is then not this lane's.
 */
function indexerOf(lanePath) {
  if (process.env.KJ_RAG_DB) return null;
  const marker = readBootstrap(lanePath);
  return Number.isInteger(marker?.pid) && !marker.stoppedAt ? marker.pid : null;
}

/** D6: stops each removable lane's indexer; a lane whose indexer survives (marker still running) is kept, saying so. */
export async function stopLaneIndexers(lanes, { stop, stillRunning }) {
  for (const l of lanes.filter((x) => x.indexer && x.reasons.length === 0)) {
    if (!(await stop(l)) && (await stillRunning(l))) l.reasons.push(`its background index (pid ${l.indexer.pid}) could not be stopped`);
  }
}

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
    const entries = laneWork(status, lane.path).filter((e) => !ragOnly(lane.path, e.slice(3)));
    if (entries.some((e) => !e.startsWith("!! "))) reasons.push("uncommitted changes");
    // Ignored files can be valuable (.env, local artifacts); only regenerable dirs are not.
    const precious = entries.filter((e) => e.startsWith("!! ") && !REGENERABLE.has(e.slice(3).split("/")[0]));
    if (precious.length > 0) reasons.push(`ignored files that are not regenerable (${precious[0].slice(3)}${precious.length > 1 ? ", …" : ""})`);
    // The lane's HEAD, branch or detached: a detached lane's commits have no other name.
    const ahead = await commitsNotIn({ git, base, cwd: lane.path });
    if (ahead > 0) reasons.push(`${ahead} commit(s) not in ${base}`);
    // The lane's own indexer alone is no reason to keep it (HU-3092); without pids (older callers) any process still is.
    const inLane = (processes?.procs ?? []).filter((p) => inside(p.cwd, lane.path));
    const indexer = processes?.procs ? indexerOf(lane.path) : null;
    const busy = processes !== null && [...processes.cwds].some((cwd) => inside(cwd, lane.path));
    const owned = busy && indexer !== null && inLane.every((p) => p.pid === indexer) ? { pid: indexer } : null;
    if (processes === null) reasons.push("cannot check for live processes on this platform");
    else if (busy && !owned) reasons.push("a live process works in it");
    // The owned indexer excluded, processes that cannot be inspected still protect a recently active lane.
    else if (processes.unseen > 0 && (await idleHours(git, lane.path, now)) < IDLE_HOURS) {
      reasons.push(`${processes.unseen} process(es) of yours cannot be inspected and the lane changed in the last ${IDLE_HOURS} h`);
    }
    return { slug: path.basename(lane.path), path: lane.path, branch: lane.branch, reasons, indexer: owned };
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
