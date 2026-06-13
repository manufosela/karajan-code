/**
 * workflow-engine — seeds CI quality workflows for `kj harden` (KJC-TSK-0557).
 *
 * Seed-if-absent into `.github/workflows/`: a workflow the user already wrote
 * (no kj:managed marker) is left untouched and reported "skipped". kj-managed
 * workflows refresh in place. Markers ride in YAML `#` comments.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { WORKFLOWS } from "./workflow-templates.js";

const BLOCK_VERSION = 1;
const WORKFLOWS_DIR = join(".github", "workflows");

export function installWorkflows({ projectDir = process.cwd(), dryRun = false } = {}) {
  const dir = join(projectDir, WORKFLOWS_DIR);
  const results = [];
  for (const wf of WORKFLOWS) {
    const target = join(dir, wf.file);
    const label = join(WORKFLOWS_DIR, wf.file);
    const exists = existsSync(target);
    const source = exists ? readFileSync(target, "utf8") : "";
    if (exists && !source.includes(`kj:managed:${wf.blockId}`)) {
      results.push({ file: label, action: "skipped" });
      continue;
    }
    const { content, action } = upsertManagedBlock({
      source,
      blockId: wf.blockId,
      version: BLOCK_VERSION,
      body: wf.body,
      style: "hash",
    });
    if (!dryRun && action !== "unchanged") {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, content);
    }
    results.push({ file: label, action });
  }
  return { dryRun, workflows: results };
}
