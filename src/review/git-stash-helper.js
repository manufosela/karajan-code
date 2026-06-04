// Surgical stash helper for the TDD discipline gate (KJC-TSK-0398 PR2).
// Stashes only the source files we want to hide for the "red" run and
// restores them afterwards. Tracked files use `git stash push -- <paths>`;
// untracked files (not yet known to git) are moved aside to a private
// `.karajan/tmp/stash-<id>/` tree because `git stash` would ignore them.

import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runCommand } from "../utils/process.js";

function defaultRunner(cmd, args, opts) {
  return runCommand(cmd, args, opts);
}

async function isTracked(runner, projectDir, file) {
  const res = await runner("git", ["ls-files", "--error-unmatch", "--", file], { cwd: projectDir });
  return res.exitCode === 0;
}

async function stashRefForToken(runner, projectDir, marker) {
  const res = await runner("git", ["stash", "list"], { cwd: projectDir });
  if (res.exitCode !== 0) return null;
  for (const line of String(res.stdout || "").split("\n")) {
    if (line.includes(marker)) {
      const m = line.match(/^(stash@\{\d+\})/);
      if (m) return m[1];
    }
  }
  return null;
}

// Move `files` aside so a test run sees them as missing. Returns a token to
// pass to `restoreFiles()`. Throws on failure with the partial token attached.
export async function stashFilesAside(files, { projectDir = process.cwd(), runner = defaultRunner, tmpRoot } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return { trackedStashRef: null, untrackedMoves: [], marker: null };
  }
  const tracked = [];
  const untracked = [];
  for (const f of files) {
    if (await isTracked(runner, projectDir, f)) tracked.push(f);
    else if (existsSync(resolve(projectDir, f))) untracked.push(f);
  }

  const marker = `kj-tdd-discipline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stashRoot = tmpRoot || join(projectDir, ".karajan", "tmp", marker);
  const untrackedMoves = [];
  let trackedStashRef = null;

  if (tracked.length > 0) {
    const args = ["stash", "push", "--keep-index", "-m", marker, "--", ...tracked];
    const res = await runner("git", args, { cwd: projectDir });
    if (res.exitCode !== 0) {
      throw new Error(`git stash push failed: ${res.stderr || res.stdout}`);
    }
    trackedStashRef = await stashRefForToken(runner, projectDir, marker);
  }

  for (const f of untracked) {
    const src = resolve(projectDir, f);
    const dst = join(stashRoot, f);
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);
    untrackedMoves.push({ src, dst });
  }

  return { trackedStashRef, untrackedMoves, marker, stashRoot };
}

// Reverse a `stashFilesAside` token. Idempotent: a restored token becomes a no-op.
export async function restoreFiles(token, { projectDir = process.cwd(), runner = defaultRunner } = {}) {
  if (!token || (token.trackedStashRef == null && token.untrackedMoves.length === 0)) return;

  for (const { src, dst } of token.untrackedMoves) {
    if (existsSync(dst)) {
      await mkdir(dirname(src), { recursive: true });
      await rename(dst, src);
    }
  }
  if (token.stashRoot && existsSync(token.stashRoot)) {
    await rm(token.stashRoot, { recursive: true, force: true });
  }

  if (token.trackedStashRef) {
    const res = await runner("git", ["stash", "pop", token.trackedStashRef], { cwd: projectDir });
    if (res.exitCode !== 0) {
      throw new Error(`git stash pop failed: ${res.stderr || res.stdout}`);
    }
  }
  token.trackedStashRef = null;
  token.untrackedMoves = [];
}

// Run `body` with `files` stashed aside, always restoring them — even when
// `body` throws. The TDD discipline stage wraps its "red" run with this.
export async function withStashedFiles(files, body, opts = {}) {
  const token = await stashFilesAside(files, opts);
  try {
    return await body(token);
  } finally {
    await restoreFiles(token, opts).catch(() => { /* swallow: surface body error */ });
  }
}
