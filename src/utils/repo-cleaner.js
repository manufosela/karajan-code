/**
 * Repo-level cleaner — KJC-TSK-0499 PR1. Read-only collector that
 * surfaces stale local artifacts so the user can decide what to drop.
 * Detects: branches merged into a base ref, branches with `[gone]`
 * upstream, top-level `dist/` `coverage/` `logs/` older than N days,
 * `*.tmp` / `*.bak` older than N days. Never spawns destructive ops.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DIRS = ["dist", "coverage", "logs"];
const STALE_FILE_RX = /\.(tmp|bak)$/;

async function safeGit(cwd, args) {
  try {
    const { stdout, exitCode } = await execa("git", args, { cwd, reject: false });
    return exitCode === 0 ? stdout : "";
  } catch { return ""; }
}

async function collectBranches(cwd, baseRef) {
  const items = [];
  const baseShort = baseRef.replace(/^origin\//, "");
  const current = (await safeGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
  const merged = await safeGit(cwd, ["branch", "--merged", baseRef, "--format=%(refname:short)"]);
  for (const raw of merged.split("\n")) {
    const name = raw.trim();
    if (!name || name === current || name === baseShort) continue;
    items.push({ kind: "branch", target: name, reason: `merged into ${baseRef}`, command: `git branch -d ${name}` });
  }
  for (const line of (await safeGit(cwd, ["branch", "-vv"])).split("\n")) {
    const m = line.match(/^[\s*]+(\S+)\s+\S+\s+\[[^:]+: gone\]/);
    if (m && m[1] !== current) items.push({ kind: "branch-gone", target: m[1], reason: "upstream gone", command: `git branch -D ${m[1]}` });
  }
  return items;
}

async function ageMs(p) {
  try { return Date.now() - (await fs.stat(p)).mtimeMs; } catch { return -1; }
}

async function collectStale(cwd, maxAgeDays) {
  const cutoff = maxAgeDays * DAY_MS;
  const items = [];
  for (const name of STALE_DIRS) {
    const full = path.join(cwd, name);
    if (await ageMs(full) > cutoff) {
      items.push({ kind: "dir", target: full, reason: `${name}/ older than ${maxAgeDays}d`, command: `rm -rf ${full}` });
    }
  }
  let entries = [];
  try { entries = await fs.readdir(cwd, { withFileTypes: true }); } catch { /* cwd unreadable */ }
  for (const e of entries) {
    if (!e.isFile() || !STALE_FILE_RX.test(e.name)) continue;
    const full = path.join(cwd, e.name);
    if (await ageMs(full) > cutoff) {
      items.push({ kind: "file", target: full, reason: `${path.extname(e.name)} older than ${maxAgeDays}d`, command: `rm -f ${full}` });
    }
  }
  return items;
}

/**
 * Discover repo-level cleanup candidates.
 * @param {object} opts
 * @param {string} [opts.cwd=process.cwd()]
 * @param {number} [opts.maxAgeDays=7]
 * @param {string} [opts.mergedTo="origin/main"]
 * @returns {Promise<{candidates: Array, errors: Array}>}
 */
export async function collectRepoCandidates({ cwd = process.cwd(), maxAgeDays = 7, mergedTo = "origin/main" } = {}) {
  const candidates = [];
  const errors = [];
  try { candidates.push(...await collectBranches(cwd, mergedTo)); } catch (e) { errors.push({ stage: "branches", error: String(e?.message ?? e) }); }
  try { candidates.push(...await collectStale(cwd, maxAgeDays)); } catch (e) { errors.push({ stage: "stale", error: String(e?.message ?? e) }); }
  return { candidates, errors };
}
