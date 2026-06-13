/**
 * `kj check` — verify the quality harness installed by `kj harden`
 * (KJC-TSK-0558). Prints a per-category table and returns an exit code so it
 * works both locally and as a CI drift gate. `--json` for machine output.
 */

import { checkHarden } from "../harden/check.js";

export async function checkCommand({ projectDir = process.cwd(), profile = "standard", json = false, logger = console } = {}) {
  const result = await checkHarden({ projectDir, profile });

  if (json) {
    logger.info?.(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  logger.info?.(`kj check (${profile})`);
  for (const c of result.checks) logger.info?.(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  if (!result.ok) logger.info?.("Harness drift detected — run `kj harden` to repair.");
  else logger.info?.("Harness OK.");
  return result.ok ? 0 : 1;
}
