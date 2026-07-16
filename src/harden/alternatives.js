/**
 * Cross-tool alternatives for `kj harden` (KJC-TSK-0614).
 *
 * A user's Biome config replaces BOTH eslint and prettier — seeding kj's
 * configs next to biome.json installs a second, conflicting linter/formatter
 * that fights the user's own hooks. The advisory's EQUIVALENTS map only
 * covers same-tool filename variants; this map covers whole-tool
 * substitutions, and the three surfaces (advisory, config-engine, check)
 * consult it before treating an artifact as missing.
 *
 * Detection is config-file based on purpose: deterministic, and a false
 * negative just means kj proposes its default (the pre-0614 behaviour),
 * never that it overwrites the user's tool.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const ALTERNATIVES = {
  eslint: [{ tool: "biome", files: ["biome.json", "biome.jsonc"] }],
  prettier: [{ tool: "biome", files: ["biome.json", "biome.jsonc"] }],
};

/**
 * First alternative tool that satisfies `artifactId`, searching each dir in
 * order (a language root first, then the repo root — a root-level biome.json
 * covers the whole monorepo). Null when none applies.
 *
 * @param {string[]} searchDirs
 * @param {string} artifactId - "eslint" | "prettier" | ...
 * @returns {{ tool: string, foundAt: string }|null}
 */
export function findAlternative(searchDirs, artifactId) {
  for (const alt of ALTERNATIVES[artifactId] ?? []) {
    for (const dir of searchDirs) {
      for (const rel of alt.files) {
        if (existsSync(join(dir, rel))) return { tool: alt.tool, foundAt: rel };
      }
    }
  }
  return null;
}

/**
 * Artifact id for a config-template entry — same convention as the
 * advisory's toArtifact: prettier is the only marker-less JSON config.
 */
export function artifactIdForConfig(cfg) {
  return cfg.blockId ?? "prettier";
}
