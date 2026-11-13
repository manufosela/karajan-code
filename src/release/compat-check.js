/**
 * The compatibility check of a release candidate (ADR 0057, step 4), in temporary detached worktrees:
 * the candidate's own suite, and this participant's lane rebased on it. The user's tree is never touched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** 0 without an error; else its exit code, or 1 when it has none (could not start, killed by a signal). */
export function exitCodeOf(error) {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : 1;
}

const runDefault = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { ...opts, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ code: exitCodeOf(error), stdout, stderr });
  });
});

async function inWorktree({ run, projectDir, ref }, work) {
  const dir = await mkdtemp(path.join(tmpdir(), "kj-release-check-"));
  const wt = path.join(dir, "wt");
  try {
    const added = await run("git", ["worktree", "add", "--detach", wt, ref], { cwd: projectDir });
    if (added.code !== 0) throw new Error(`git worktree add failed for ${ref}`);
    return await work(wt);
  } finally {
    await run("git", ["worktree", "remove", "--force", wt], { cwd: projectDir });
    await rm(dir, { recursive: true, force: true });
  }
}

const DETAIL_LINES = 20;

/** The last lines of a failed step (stdout then stderr), trimmed: why it failed. */
function tail(step) {
  return `${step.stdout ?? ""}\n${step.stderr ?? ""}`.trim().split("\n").slice(-DETAIL_LINES).join("\n").trim();
}

const passed = { pass: true };
const failedAt = (step) => ({ pass: false, detail: tail(step) });

const HEARTBEAT_MS = 30_000;
/** The default progress sink: stderr, so the answer block on stdout stays clean. */
export const stderrProgress = (line) => process.stderr.write(`${line}\n`);
const elapsed = (ms) => (ms < 60_000 ? `${Math.floor(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min`);

/** Runs one step between its announcement and its outcome, with a heartbeat every 30 s while it runs. */
async function step(progress, { label, starting = label }, work) {
  progress(`release check: ${starting}…`);
  const started = Date.now();
  const beat = setInterval(() => progress(`release check: still ${label} (${elapsed(Date.now() - started)})…`), HEARTBEAT_MS);
  try {
    const result = await work();
    progress(`release check: ${label}… ${result.code === 0 ? "passed" : "failed"}`);
    return result;
  } finally {
    clearInterval(beat);
  }
}

// Installed as the repository is installed day to day (scripts run, native modules such as node-pty get built):
// the candidate is a commit of the reviewed base branch, the same code every participant installs in each lane.
async function suiteOutcome({ run, cwd, progress, who, install }) {
  const installed = await step(progress, { label: install }, () => run("npm", ["ci"], { cwd }));
  if (installed.code !== 0) return failedAt(installed);
  const test = await step(progress, { label: `running ${who}'s suite`, starting: `running ${who}'s suite (several minutes)` }, () => run("npm", ["test"], { cwd }));
  return test.code === 0 ? passed : failedAt(test);
}

async function hasOwnCommits({ run, projectDir, candidate, baseBranch }) {
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir })).stdout.trim();
  if (branch === baseBranch) return false;
  const ahead = await run("git", ["rev-list", "--count", `${candidate}..HEAD`], { cwd: projectDir });
  return Number(ahead.stdout.trim()) > 0;
}

async function laneResult({ run, projectDir, candidate, progress }) {
  return inWorktree({ run, projectDir, ref: "HEAD" }, async (wt) => {
    const rebase = await step(progress, { label: "rebasing your lane onto the candidate" }, () => run("git", ["rebase", candidate], { cwd: wt }));
    return rebase.code === 0 ? suiteOutcome({ run, cwd: wt, progress, who: "your lane", install: "installing your lane (npm ci)" }) : failedAt(rebase);
  });
}

/** @returns {Promise<{ suite: "pass"|"fail", lane: "pass"|"fail"|"none", detail?: string }>} detail: why a step failed */
export async function compatCheck({ projectDir, candidate, baseBranch = "main", run = runDefault, progress = stderrProgress }) {
  await run("git", ["fetch", "origin", candidate], { cwd: projectDir });
  const suite = await inWorktree({ run, projectDir, ref: candidate }, (wt) => suiteOutcome({ run, cwd: wt, progress, who: "the candidate", install: `installing the candidate ${candidate.slice(0, 7)} (npm ci)` }));
  const own = await hasOwnCommits({ run, projectDir, candidate, baseBranch });
  const lane = own ? await laneResult({ run, projectDir, candidate, progress }) : null;
  const detail = [suite.detail, lane?.detail].filter(Boolean).join("\n");
  const verdict = (outcome) => (outcome.pass ? "pass" : "fail");
  return { suite: verdict(suite), lane: lane ? verdict(lane) : "none", ...(detail ? { detail } : {}) };
}
