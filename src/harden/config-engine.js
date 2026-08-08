/**
 * config-engine — seeds/refreshes lint/format/commit config for `kj harden`
 * (KJC-TSK-0556). Seed-if-absent: a config the user already authored (no
 * kj:managed marker) is left untouched and reported as "skipped". Markered
 * files refresh in place; JSON files (no comment syntax) are seed-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { findEquivalentIn } from "./advisory.js";
import { artifactIdForConfig, findAlternative } from "./alternatives.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";

const BLOCK_VERSION = 1;

// KJC-BUG-0137 (issue #1357): is the tool a config demands actually installed?
// Declared dependency or a resolvable bin both count; an unreadable
// package.json is no evidence of the tool.
function hasTool(dirs, tool) {
  for (const d of dirs) {
    if (existsSync(join(d, "node_modules", ".bin", tool))) return true;
    const pkgPath = join(d, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.devDependencies?.[tool] || pkg.dependencies?.[tool]) return true;
    } catch {
      /* unreadable ⇒ keep looking */
    }
  }
  return false;
}

function writeFile(target, content) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Seed a list of config entries into `targetDir`, labelling each by `prefix`.
 * `altDirs` widens the cross-tool alternative lookup (KJC-TSK-0614): a config
 * covered by the user's own tool (biome.json ⇒ eslint+prettier) is never
 * seeded — kj must not install a second, conflicting linter/formatter.
 */
function seedInto(targetDir, configs, dryRun, prefix, results, altDirs = [targetDir]) {
  for (const cfg of configs) {
    const target = join(targetDir, cfg.file);
    const exists = existsSync(target);
    const file = prefix === "." ? cfg.file : join(prefix, cfg.file);

    if (!exists) {
      const alt = findAlternative(altDirs, artifactIdForConfig(cfg));
      if (alt) {
        results.push({ file, action: "covered", by: alt.foundAt });
        continue;
      }
      // KJC-BUG-0119: a same-tool variant (eslint.config.mjs, .eslintrc.json,
      // package.json#eslintConfig…) means the config already EXISTS — seeding
      // kj's default filename next to it would silently ECLIPSE the user's
      // real config (eslint resolves eslint.config.js before .mjs).
      const variant = findEquivalentIn(altDirs, artifactIdForConfig(cfg));
      if (variant) {
        results.push({ file, action: "covered", by: variant });
        continue;
      }
      // KJC-BUG-0137: no tool ⇒ no config — report the actionable gap instead.
      if (cfg.requires && !hasTool(altDirs, cfg.requires)) {
        results.push({
          file,
          action: "omitted",
          note: `${cfg.requires} is not installed — npm i -D ${cfg.requires}, then re-run kj harden`,
        });
        continue;
      }
    }

    if (cfg.json) {
      const action = exists ? "skipped" : "inserted";
      if (!dryRun && !exists) writeFile(target, `${cfg.body}\n`);
      results.push({ file, action });
      continue;
    }

    const source = exists ? readFileSync(target, "utf8") : "";
    if (exists && !source.includes(`kj:managed:${cfg.blockId}`)) {
      results.push({ file, action: "skipped" });
      continue;
    }
    const { content, action } = upsertManagedBlock({
      source,
      blockId: cfg.blockId,
      version: BLOCK_VERSION,
      body: cfg.body,
      style: cfg.style,
    });
    if (!dryRun && action !== "unchanged") writeFile(target, content);
    results.push({ file, action });
  }
}

/**
 * Single-directory seed: universal (.editorconfig, commitlint) plus the
 * language's lint/format config, all at `projectDir`. Unknown language ⇒
 * universal only. `dryRun` computes actions without writing.
 */
export function installConfigs({ projectDir = process.cwd(), language = "javascript", dryRun = false } = {}) {
  const results = [];
  seedInto(projectDir, [...UNIVERSAL_CONFIGS, ...(CONFIGS_BY_LANGUAGE[language] ?? [])], dryRun, ".", results);
  return { dryRun, configs: results };
}

/**
 * Monorepo seed: universal config once at the root, then each language's
 * lint/format config inside its own root (from detectStackRoots). A fullstack
 * repo gets eslint in frontend/, ruff in backend/, etc.
 */
export function installConfigsForRoots({ projectDir = process.cwd(), roots = [], dryRun = false } = {}) {
  const results = [];
  seedInto(projectDir, UNIVERSAL_CONFIGS, dryRun, ".", results);
  for (const { dir, language } of roots) {
    const rootDir = join(projectDir, dir);
    // A root-level biome.json covers every language root of the monorepo.
    seedInto(rootDir, CONFIGS_BY_LANGUAGE[language] ?? [], dryRun, dir, results, [rootDir, projectDir]);
  }
  return { dryRun, configs: results };
}
