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
  execFile(cmd, args, { ...opts, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    resolve({ code: exitCodeOf(error), stdout });
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

async function suitePasses(run, cwd) {
  const install = await run("npm", ["ci", "--ignore-scripts"], { cwd });
  if (install.code !== 0) return false;
  return (await run("npm", ["test"], { cwd })).code === 0;
}

async function hasOwnCommits({ run, projectDir, candidate, baseBranch }) {
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir })).stdout.trim();
  if (branch === baseBranch) return false;
  const ahead = await run("git", ["rev-list", "--count", `${candidate}..HEAD`], { cwd: projectDir });
  return Number(ahead.stdout.trim()) > 0;
}

async function laneResult({ run, projectDir, candidate }) {
  return inWorktree({ run, projectDir, ref: "HEAD" }, async (wt) => {
    const rebase = await run("git", ["rebase", candidate], { cwd: wt });
    if (rebase.code !== 0) return "fail";
    return (await suitePasses(run, wt)) ? "pass" : "fail";
  });
}

/** @returns {Promise<{ suite: "pass"|"fail", lane: "pass"|"fail"|"none" }>} */
export async function compatCheck({ projectDir, candidate, baseBranch = "main", run = runDefault }) {
  await run("git", ["fetch", "origin", candidate], { cwd: projectDir });
  const suite = await inWorktree({ run, projectDir, ref: candidate }, async (wt) => ((await suitePasses(run, wt)) ? "pass" : "fail"));
  const own = await hasOwnCommits({ run, projectDir, candidate, baseBranch });
  return { suite, lane: own ? await laneResult({ run, projectDir, candidate }) : "none" };
}
