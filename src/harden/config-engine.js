/**
 * config-engine — seeds/refreshes lint/format/commit config for `kj harden`
 * (KJC-TSK-0556). Seed-if-absent: a config the user already authored (no
 * kj:managed marker) is left untouched and reported as "skipped". Markered
 * files refresh in place; JSON files (no comment syntax) are seed-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { artifactIdForConfig, findAlternative } from "./alternatives.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";

const BLOCK_VERSION = 1;

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
