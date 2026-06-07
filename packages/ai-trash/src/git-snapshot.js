// Git snapshot primitive (KJC-TSK-0389 commit 1). Captures the full repo
// state via `git bundle create --all` before a destructive git op runs so
// the hook can restore lost commits/refs afterwards. The bundle includes
// every reachable commit + every ref (branches + tags), letting
// `git fetch --all <bundle>` rebuild HEAD + ref tips even after a
// `reset --hard`, `branch -D`, or `push --force`.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ulid } from "./ulid.js";
import { ensureSecureDir, lockdownFile } from "./permissions.js";
import { appendLogEntry } from "./logger.js";

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function captureRefs(repoDir) {
  const res = await runGit(["show-ref", "--head"], repoDir);
  if (res.code !== 0) return [];
  return res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/, 2);
      return { sha, ref };
    });
}

/**
 * Snapshot the full state of a git repository as a `.bundle` file so the
 * pre-op refs can be restored after a destructive op. Returns a manifest
 * entry shaped like `snapshotFile`'s output so the manifest layer can
 * store both file and git snapshots side by side.
 *
 * @param {string} rootDir - ai-trash root (`<root>/store/<id>/repo.bundle`).
 * @param {string} repoDir - target git repository.
 * @param {{command?: string, origin?: string, label?: string}} [options]
 * @returns {Promise<object>} manifest entry with type=`git-bundle`.
 */
export async function snapshotGitBundle(rootDir, repoDir, options = {}) {
  const insideRepo = await runGit(["rev-parse", "--is-inside-work-tree"], repoDir);
  if (insideRepo.code !== 0 || insideRepo.stdout.trim() !== "true") {
    throw new Error(`ai-trash: not a git repo: ${repoDir}`);
  }
  const id = ulid();
  const storeDir = join(rootDir, "store", id);
  await ensureSecureDir(storeDir);
  const bundlePath = join(storeDir, "repo.bundle");
  const bundle = await runGit(["bundle", "create", bundlePath, "--all"], repoDir);
  if (bundle.code !== 0) {
    throw new Error(`ai-trash: git bundle failed: ${bundle.stderr.trim()}`);
  }
  await lockdownFile(bundlePath);
  const refs = await captureRefs(repoDir);
  const stat = await fs.stat(bundlePath);
  const entry = {
    id,
    type: "git-bundle",
    createdAt: Date.now(),
    sourcePath: repoDir,
    snapshotPath: bundlePath,
    sizeBytes: stat.size,
    refs,
    command: options.command ?? null,
    origin: options.origin ?? "unknown",
    label: options.label ?? null,
  };
  await appendLogEntry(rootDir, "snapshot.git-bundle", {
    id,
    repoDir,
    bundlePath,
    sizeBytes: stat.size,
    refCount: refs.length,
  });
  return entry;
}
