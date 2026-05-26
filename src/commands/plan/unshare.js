/**
 * kj plan unshare <planId>
 *
 * Inverse of `kj plan share`. Removes the plan from the project's shared dir
 * (`<projectDir>/.karajan-shared/plans/`). The per-user copy at
 * `~/.karajan/plans/<projectSlug>/<planId>.json` stays untouched, so the dev
 * keeps the plan locally while the team stops seeing it. KJC-PRP-0002 / PR3.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getSharedPlansDir } from "../../utils/shared-paths.js";

export async function planUnshareCommand({ config, planId, logger }) {
  const log = logger || console;
  const projectDir = config.projectDir || process.cwd();

  if (!planId) {
    log.error?.("kj plan unshare <planId> — planId is required");
    process.exitCode = 1;
    return;
  }

  const sharedDir = getSharedPlansDir(projectDir);
  const targetFile = path.join(sharedDir, `${planId}.json`);

  try {
    await fs.unlink(targetFile);
  } catch (err) {
    if (err.code === "ENOENT") {
      log.error?.(`Plan not shared: ${planId} (no file at .karajan-shared/plans/)`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const rel = path.relative(projectDir, targetFile);
  log.info?.(`✓ Unshared plan ${planId} (removed ${rel})`);
  log.info?.(`  Commit '.karajan-shared/' so your team stops seeing it.`);
}
