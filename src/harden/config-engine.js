/**
 * config-engine — seeds/refreshes lint/format/commit config for `kj harden`
 * (KJC-TSK-0556). Seed-if-absent: a config the user already authored (no
 * kj:managed marker) is left untouched and reported as "skipped". Markered
 * files refresh in place; JSON files (no comment syntax) are seed-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";

const BLOCK_VERSION = 1;

function writeFile(target, content) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Seed a list of config entries into `targetDir`, labelling each by `prefix`. */
function seedInto(targetDir, configs, dryRun, prefix, results) {
  for (const cfg of configs) {
    const target = join(targetDir, cfg.file);
    const exists = existsSync(target);
    const file = prefix === "." ? cfg.file : join(prefix, cfg.file);

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
    seedInto(join(projectDir, dir), CONFIGS_BY_LANGUAGE[language] ?? [], dryRun, dir, results);
  }
  return { dryRun, configs: results };
}
