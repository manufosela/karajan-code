/**
 * `kj clean` — manual garbage collector.
 *
 * Shows or deletes accumulated state under `~/.kj/plans/` and
 * `~/.karajan/` (sessions, HU story batches). Dry-run by default so
 * the user can eyeball the plan before committing to it.
 *
 * Usage:
 *   kj clean                         # dry-run, shows what would be removed
 *   kj clean --yes                   # actually delete
 *   kj clean --plan-days 60          # keep finalised plans for 60 days instead of 30
 *   kj clean --draft-days 90         # keep drafts for 90 days instead of 60
 *   kj clean --session-days 14       # keep finalised sessions for 14 days instead of 7
 *   kj clean --hu-days 30            # keep HU batches for 30 days instead of 14
 *
 * The auto-GC that runs at the start of every `kj run` / `kj plan`
 * uses the same retention defaults; tweaking them here lets the user
 * sweep more or less aggressively without editing config.
 */

import { runManualGC, summarizeGC } from "../utils/garbage-collector.js";

/**
 * @param {Object} opts
 * @param {boolean} [opts.yes=false]           - when false, dry-run only
 * @param {number}  [opts.planDays=30]
 * @param {number}  [opts.draftDays=60]
 * @param {number}  [opts.sessionDays=7]
 * @param {number}  [opts.huDays=14]
 * @param {Object}  [opts.logger]
 */
export async function cleanCommand(opts = {}) {
  const dryRun = !opts.yes;
  const result = await runManualGC({
    planRetentionDays: opts.planDays,
    draftRetentionDays: opts.draftDays,
    sessionRetentionDays: opts.sessionDays,
    huRetentionDays: opts.huDays,
    dryRun,
  });

  if (!result.removed.length) {
    console.log("[clean] nothing to clean — ~/.kj/ and ~/.karajan/ are tidy.");
    return { ok: true, removed: 0 };
  }

  const verb = dryRun ? "would remove" : "removed";
  console.log(`[clean] ${verb} ${result.removed.length} item(s):`);
  for (const r of result.removed) {
    console.log(`  - ${r.kind.padEnd(10)} ${r.path}`);
    console.log(`                 ${r.reason}`);
  }

  const kb = Math.round(result.bytesFreed / 1024);
  if (kb) console.log(`[clean] ${verb} ${kb} KiB total`);

  if (result.errors.length) {
    console.log(`[clean] ${result.errors.length} error(s) (non-blocking):`);
    for (const e of result.errors) console.log(`  - ${e.path}: ${e.error}`);
  }

  if (dryRun) {
    console.log("");
    console.log("[clean] DRY-RUN — no files touched. Re-run with --yes to actually delete.");
  } else {
    console.log(summarizeGC(result));
  }

  return { ok: true, removed: result.removed.length, bytesFreed: result.bytesFreed };
}
