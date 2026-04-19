/**
 * Build a directory-grouped tree view of files affected during the session,
 * rendered as `.reviews/{sessionId}/tree.txt`.
 *
 * Acceptance criterion (KJC-TSK-0288):
 *   - Given a kj run that modifies files, when the session finishes, then
 *     tree.txt contains the tree of affected files (modified/added/deleted)
 *     grouped by directory, generated from `git diff --name-status` against
 *     the base ref.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../../utils/process.js";

const STATUS_LABELS = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
  U: "unmerged",
};

/**
 * @typedef {Object} DiffEntry
 * @property {string} file    - path relative to repo root
 * @property {string} status  - "modified" | "added" | "deleted" | ...
 */

/**
 * Parse `git diff --name-status` output into structured entries.
 *
 * @param {string} rawDiff
 * @returns {DiffEntry[]}
 */
export function parseNameStatus(rawDiff) {
  if (!rawDiff || !rawDiff.trim()) return [];
  const entries = [];
  for (const line of rawDiff.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    // Renames and copies report "R<score>\told\tnew". Take the new path.
    const file = parts.length >= 3 ? parts[2] : parts[1];
    if (!status || !file) continue;
    const key = status[0];
    const label = STATUS_LABELS[key] || "other";
    entries.push({ file, status: label });
  }
  return entries;
}

/**
 * Group entries into a nested directory tree.
 * Each node is { name, children: Map<string, node>, entries: DiffEntry[] }.
 *
 * @param {DiffEntry[]} entries
 * @returns {{name:string, children:Map<string, any>, files:DiffEntry[]}}
 */
export function buildTree(entries) {
  const root = { name: "", children: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.file.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node.children.has(dir)) {
        node.children.set(dir, { name: dir, children: new Map(), files: [] });
      }
      node = node.children.get(dir);
    }
    node.files.push({ file: parts.at(-1), status: entry.status });
  }
  return root;
}

/**
 * Render a tree node as indented text. Directories come before files at each
 * level; both are sorted alphabetically (case-insensitive).
 */
function renderNode(node, depth, lines) {
  const indent = "  ".repeat(depth);
  const dirs = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const dir of dirs) {
    lines.push(`${indent}${dir.name}/`);
    renderNode(dir, depth + 1, lines);
  }
  const files = [...node.files].sort((a, b) => a.file.localeCompare(b.file, undefined, { sensitivity: "base" }));
  for (const f of files) {
    lines.push(`${indent}${f.file} [${f.status}]`);
  }
}

/**
 * Render the tree as a self-describing text document.
 * Returns null when there are no entries.
 *
 * @param {DiffEntry[]} entries
 * @returns {string|null}
 */
export function renderTree(entries) {
  if (!entries || entries.length === 0) return null;
  const tree = buildTree(entries);
  const lines = ["# Affected files (grouped by directory)", ""];
  renderNode(tree, 0, lines);
  lines.push("");

  // Summary counts at the bottom for quick scanning.
  const counts = entries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${n} ${status}`)
    .join(", ");
  lines.push(`Total: ${entries.length} file${entries.length === 1 ? "" : "s"} — ${summary}`);
  return lines.join("\n");
}

/**
 * Run `git diff --name-status <baseRef>...HEAD` and return structured entries.
 * Returns [] if git exits with an error or produces no output.
 *
 * @param {string} baseRef
 * @returns {Promise<DiffEntry[]>}
 */
export async function collectAffectedFiles(baseRef) {
  if (!baseRef) return [];
  try {
    const result = await runCommand("git", ["diff", "--name-status", `${baseRef}...HEAD`]);
    if (result.exitCode !== 0) return [];
    return parseNameStatus(result.stdout || "");
  } catch {
    return [];
  }
}

/**
 * High-level: generate the tree content and persist it to `tree.txt` under
 * the given journal directory. Returns `{ written, path }`.
 *
 * @param {string} journalDir
 * @param {string} baseRef
 * @param {{ logger?: Object }} [options]
 * @returns {Promise<{ written: boolean, path: string|null }>}
 */
export async function writeTreeJournal(journalDir, baseRef, options = {}) {
  const entries = await collectAffectedFiles(baseRef);
  const content = renderTree(entries);
  if (!content) return { written: false, path: null };
  const filePath = path.join(journalDir, "tree.txt");
  try {
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(filePath, content + "\n", "utf8");
    options.logger?.info?.(`Wrote file tree journal: ${filePath}`);
    return { written: true, path: filePath };
  } catch (err) {
    options.logger?.warn?.(`Failed to write tree journal (non-blocking): ${err.message}`);
    return { written: false, path: null };
  }
}
