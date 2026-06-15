/**
 * detectStackRoots — find every language root in a (possibly monorepo) tree
 * for `kj harden` (KJC-TSK-0561).
 *
 * Walks the project up to a shallow depth and returns the shallowest
 * directory where each language appears, e.g. a fullstack repo yields
 * `[{dir:"frontend",language:"javascript"},{dir:"backend",language:"python"}]`
 * so lint/format config is seeded on each side. Universal config (handled by
 * the caller) stays at the project root. Noise dirs are never descended.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  "venv",
  // Auxiliary code that isn't the app to harden (KJC-TSK-0564): demo/fixture
  // dirs ship their own throwaway manifests and must not seed lint/CI config.
  "examples",
  "example",
  "fixtures",
  "samples",
  "third_party",
  "testdata",
  "__fixtures__",
]);
const DEFAULT_MAX_DEPTH = 2;

/**
 * Minimal glob for harden scope flags — no dynamic RegExp (eslint security).
 * Matches on exact equality, directory prefix (`wrappers` ⊇ `wrappers/python`)
 * and `*` wildcards anchored at both ends unless the `*` is leading/trailing.
 */
export function matchesGlob(value, pattern) {
  if (value === pattern || value.startsWith(`${pattern}/`)) return true;
  if (!pattern.includes("*")) return false;
  const pieces = pattern.split("*");
  let idx = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    if (!piece) continue;
    const at = value.indexOf(piece, idx);
    if (at === -1 || (i === 0 && at !== 0)) return false;
    idx = at + piece.length;
  }
  return pattern.endsWith("*") || value.length === idx;
}

/** Identify the language of a single directory by its manifest files. */
export function languageAt(dir) {
  if (existsSync(join(dir, "package.json"))) {
    if (existsSync(join(dir, "tsconfig.json"))) return "typescript";
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.typescript || deps["ts-node"]) return "typescript";
    } catch {
      /* unreadable package.json → treat as plain JS */
    }
    return "javascript";
  }
  if (["pyproject.toml", "requirements.txt", "setup.py"].some((f) => existsSync(join(dir, f)))) return "python";
  if (existsSync(join(dir, "go.mod"))) return "go";
  if (existsSync(join(dir, "composer.json"))) return "php";
  return null;
}

export function detectStackRoots(projectDir, { maxDepth = DEFAULT_MAX_DEPTH, only = [], exclude = [] } = {}) {
  const found = [];
  function walk(dir, depth) {
    const language = languageAt(dir);
    if (language) found.push({ dir: relative(projectDir, dir) || ".", language, depth });
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name)) {
        walk(join(dir, e.name), depth + 1);
      }
    }
  }
  walk(projectDir, 0);

  // Keep only the shallowest directory per language.
  const byLanguage = new Map();
  for (const f of found) {
    const cur = byLanguage.get(f.language);
    if (!cur || f.depth < cur.depth) byLanguage.set(f.language, f);
  }
  let roots = [...byLanguage.values()].map(({ dir, language }) => ({ dir, language }));
  if (only.length) roots = roots.filter((r) => only.some((o) => matchesGlob(r.dir, o)));
  if (exclude.length) roots = roots.filter((r) => !exclude.some((g) => matchesGlob(r.dir, g)));
  return roots.sort((a, b) => a.dir.localeCompare(b.dir));
}
