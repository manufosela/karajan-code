/**
 * kj plan share <planId>
 *
 * Promotes a local plan (under `~/.karajan/plans/<projectSlug>/`) to the
 * project's shared dir (`<projectDir>/.karajan-shared/plans/`) so teammates
 * pulling the repo see the same HUs in their HU Board. KJC-PRP-0002 / PR1.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../../utils/atomic-write.js";
import { getSharedPlansDir } from "../../utils/shared-paths.js";
import { loadPlan } from "../../plan/plan-store.js";

export async function planShareCommand({ config, planId, logger }) {
  const log = logger || console;
  const projectDir = config.projectDir || process.cwd();

  if (!planId) {
    log.error?.("kj plan share <planId> — planId is required");
    process.exitCode = 1;
    return;
  }

  const plan = await loadPlan(projectDir, planId);
  if (!plan) {
    log.error?.(`Plan not found: ${planId}`);
    process.exitCode = 1;
    return;
  }

  const sharedDir = getSharedPlansDir(projectDir);
  await fs.mkdir(sharedDir, { recursive: true });
  const targetFile = path.join(sharedDir, `${plan.planId}.json`);

  // Stamp a `shared: true` marker so consumers (board sync, audit, etc.)
  // can tell promoted copies from local ones without inspecting the path.
  const sharedPlan = { ...plan, shared: true, sharedAt: new Date().toISOString() };
  await writeJsonAtomic(targetFile, sharedPlan);

  const rel = path.relative(projectDir, targetFile);
  log.info?.(`✓ Shared plan ${plan.planId} → ${rel}`);
  log.info?.(`  Commit '.karajan-shared/' so your team picks it up.`);
}
