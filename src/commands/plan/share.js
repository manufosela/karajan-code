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

function parseIdList(raw) {
  if (!raw) return null;
  const ids = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

export async function planShareCommand({ config, planId, logger, only, exclude }) {
  const log = logger || console;
  const projectDir = config.projectDir || process.cwd();

  if (!planId) {
    log.error?.("kj plan share <planId> — planId is required");
    process.exitCode = 1;
    return;
  }

  const onlyIds = parseIdList(only);
  const excludeIds = parseIdList(exclude);
  if (onlyIds && excludeIds) {
    log.error?.("kj plan share — --only and --exclude are mutually exclusive");
    process.exitCode = 1;
    return;
  }

  const plan = await loadPlan(projectDir, planId);
  if (!plan) {
    log.error?.(`Plan not found: ${planId}`);
    process.exitCode = 1;
    return;
  }

  // KJC-PRP-0002 PR4: optional per-HU filter. Lets a dev share a curated
  // subset of HUs without splitting the plan or hand-editing the JSON.
  let hus = plan.hus || [];
  let filterSummary = "";
  if (onlyIds) {
    hus = hus.filter((h) => onlyIds.includes(h.id));
    filterSummary = ` [only: ${onlyIds.join(",")}]`;
  } else if (excludeIds) {
    hus = hus.filter((h) => !excludeIds.includes(h.id));
    filterSummary = ` [excluding: ${excludeIds.join(",")}]`;
  }
  if ((onlyIds || excludeIds) && hus.length === 0) {
    log.error?.(`No HUs left after applying filter — aborting share.`);
    process.exitCode = 1;
    return;
  }

  const sharedDir = getSharedPlansDir(projectDir);
  await fs.mkdir(sharedDir, { recursive: true });
  const targetFile = path.join(sharedDir, `${plan.planId}.json`);

  // Stamp a `shared: true` marker so consumers (board sync, audit, etc.)
  // can tell promoted copies from local ones without inspecting the path.
  const sharedPlan = {
    ...plan,
    hus,
    shared: true,
    sharedAt: new Date().toISOString(),
  };
  if (onlyIds || excludeIds) {
    sharedPlan.sharedFilter = onlyIds
      ? { only: onlyIds }
      : { exclude: excludeIds };
  }
  await writeJsonAtomic(targetFile, sharedPlan);

  const rel = path.relative(projectDir, targetFile);
  log.info?.(`✓ Shared plan ${plan.planId} → ${rel}${filterSummary}`);
  log.info?.(`  Commit '.karajan-shared/' so your team picks it up.`);
}
