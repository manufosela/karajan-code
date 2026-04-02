/**
 * Git-free diff generation using filesystem snapshots.
 *
 * Takes a snapshot of project files (path → content hash), then compares
 * a later snapshot to generate a unified diff. Works on any OS, no git needed.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_IGNORE = new Set([
  "node_modules", ".git", ".kj", ".karajan", "dist", "build",
  ".next", ".nuxt", ".svelte-kit", "__pycache__", ".venv",
  "coverage", ".nyc_output", ".reviews"
]);

const MAX_FILE_SIZE = 512 * 1024; // 512KB — skip large files

/**
 * Scan a directory recursively and return a Map of relative path → content hash.
 * @param {string} rootDir
 * @returns {Promise<Map<string, string>>} path → sha256 hash
 */
export async function takeSnapshot(rootDir) {
  const snapshot = new Map();
  await scanDir(rootDir, rootDir, snapshot);
  return snapshot;
}

async function scanDir(dir, rootDir, snapshot) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    if (DEFAULT_IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(fullPath, rootDir, snapshot);
    } else if (entry.isFile()) {
      try {
        const s = await stat(fullPath);
        if (s.size > MAX_FILE_SIZE) continue;
        const content = await readFile(fullPath);
        const hash = createHash("sha256").update(content).digest("hex");
        snapshot.set(relative(rootDir, fullPath), hash);
      } catch { /* skip unreadable files */ }
    }
  }
}

/**
 * Compare two snapshots and generate a unified diff string.
 * @param {Map<string, string>} before — snapshot before coder
 * @param {Map<string, string>|null} after — snapshot after coder (null = read from disk)
 * @param {string} rootDir — project root (for reading file contents)
 * @returns {Promise<string>} unified diff text
 */
export async function generateSnapshotDiff(before, after, rootDir) {
  if (!after) {
    after = await takeSnapshot(rootDir);
  }

  const lines = [];

  // New files (in after but not before)
  for (const [path, hash] of after) {
    if (!before.has(path)) {
      const content = await safeRead(join(rootDir, path));
      if (content !== null) {
        lines.push(`diff --snapshot a/${path} b/${path}`);
        lines.push("new file");
        lines.push(`--- /dev/null`);
        lines.push(`+++ b/${path}`);
        for (const line of content.split("\n")) {
          lines.push(`+${line}`);
        }
        lines.push("");
      }
    }
  }

  // Modified files (in both, different hash)
  for (const [path, hash] of after) {
    if (before.has(path) && before.get(path) !== hash) {
      const content = await safeRead(join(rootDir, path));
      if (content !== null) {
        lines.push(`diff --snapshot a/${path} b/${path}`);
        lines.push("modified file");
        lines.push(`--- a/${path}`);
        lines.push(`+++ b/${path}`);
        // Show full new content (we don't have the old content)
        for (const line of content.split("\n")) {
          lines.push(`+${line}`);
        }
        lines.push("");
      }
    }
  }

  // Deleted files (in before but not after)
  for (const [path] of before) {
    if (!after.has(path)) {
      lines.push(`diff --snapshot a/${path} b/${path}`);
      lines.push("deleted file");
      lines.push(`--- a/${path}`);
      lines.push(`+++ /dev/null`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, "utf-8");
  } catch { return null; }
}
