/**
 * `kj check` — verify the quality harness installed by `kj harden`
 * (KJC-TSK-0558). Prints a per-category table and returns an exit code so it
 * works both locally and as a CI drift gate. `--json` for machine output.
 */

import { checkHarden } from "../harden/check.js";
import { collectMethodStats, formatMethodStats } from "../checks/method.js";

export async function checkCommand({ projectDir = process.cwd(), profile = "standard", json = false, logger = console } = {}) {
  const result = await checkHarden({ projectDir, profile });
  // KJC-TSK-0689 (MG-D): method adherence is VISIBILITY, not a gate — it
  // rides along in check output but never affects the exit code.
  const method = await collectMethodStats({ projectDir }).catch(() => null);

  if (json) {
    logger.info?.(JSON.stringify({ ...result, method }));
    return result.ok ? 0 : 1;
  }

  logger.info?.(`kj check (${profile})`);
  for (const c of result.checks) logger.info?.(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  if (method) logger.info?.(`  method: ${formatMethodStats(method)}`);
  if (!result.ok) logger.info?.("Harness drift detected — run `kj harden` to repair.");
  else logger.info?.("Harness OK.");
  return result.ok ? 0 : 1;
}
