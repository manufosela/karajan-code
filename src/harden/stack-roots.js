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
// HU-3520: a Gradle build (Kotlin/Android/Java) is its own stack, whatever helper scripts sit beside it.
const GRADLE_MARKERS = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "gradlew"];

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
  if (GRADLE_MARKERS.some((f) => existsSync(join(dir, f)))) return "gradle";
  return null;
}

/** The `workspaces` globs a package.json declares (array or `{ packages }` form). */
function workspaceGlobs(dir) {
  try {
    const { workspaces } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const globs = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
    return Array.isArray(globs) ? globs.filter((g) => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** HU-4018: a plain-JS package that a TypeScript root lists in its workspaces belongs to that root. */
function isWorkspaceMemberOfTsRoot(candidate, found, projectDir) {
  if (candidate.language !== "javascript") return false;
  return found.some((root) => {
    if (root.language !== "typescript" || root.dir === candidate.dir) return false;
    const rel = root.dir === "." ? candidate.dir : relative(root.dir, candidate.dir);
    if (rel.startsWith("..")) return false;
    return workspaceGlobs(join(projectDir, root.dir)).some((g) => matchesGlob(rel, g.replace(/^\.\//, "")));
  });
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
    if (isWorkspaceMemberOfTsRoot(f, found, projectDir)) continue;
    const cur = byLanguage.get(f.language);
    if (!cur || f.depth < cur.depth) byLanguage.set(f.language, f);
  }
  let roots = [...byLanguage.values()].map(({ dir, language }) => ({ dir, language }));
  if (only.length) roots = roots.filter((r) => only.some((o) => matchesGlob(r.dir, o)));
  if (exclude.length) roots = roots.filter((r) => !exclude.some((g) => matchesGlob(r.dir, g)));
  return roots.sort((a, b) => a.dir.localeCompare(b.dir));
}
