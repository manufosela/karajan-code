/**
 * config-engine — seeds/refreshes lint/format/commit config for `kj harden`
 * (KJC-TSK-0556). Seed-if-absent: a config the user already authored (no
 * kj:managed marker) is left untouched and reported as "skipped". Markered
 * files refresh in place; JSON files (no comment syntax) are seed-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { JS_CONFIGS } from "./config-templates.js";

const BLOCK_VERSION = 1;

function writeFile(target, content) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Install config files for the detected stack (JS/TS for now). Returns a
 * per-file action report. `dryRun` computes actions without touching disk.
 */
export function installConfigs({ projectDir = process.cwd(), dryRun = false } = {}) {
  const results = [];
  for (const cfg of JS_CONFIGS) {
    const target = join(projectDir, cfg.file);
    const exists = existsSync(target);

    if (cfg.json) {
      const action = exists ? "skipped" : "inserted";
      if (!dryRun && !exists) writeFile(target, `${cfg.body}\n`);
      results.push({ file: cfg.file, action });
      continue;
    }

    const source = exists ? readFileSync(target, "utf8") : "";
    if (exists && !source.includes(`kj:managed:${cfg.blockId}`)) {
      results.push({ file: cfg.file, action: "skipped" });
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
    results.push({ file: cfg.file, action });
  }
  return { dryRun, configs: results };
}
