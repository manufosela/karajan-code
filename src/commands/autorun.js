/**
 * `kj autorun <spec>` — the unattended delivery chain (KJC-TSK-0574, épica
 * KJC-PCS-0062, design in docs/specs/autonomous-delivery.md §7).
 *
 * One command: spec → plan → run all HUs → outcome. It reuses `kj plan` and
 * `kj run --plan` rather than reimplementing them, and defaults to the
 * `autonomous` level so the Arbiter resolves every gate (no human in the loop).
 * The rich outcome report lands in AUTO-F; here we chain + propagate exit code.
 */

import { planGenerateCommand } from "./plan/generate.js";
import { runCommandHandler } from "./run.js";

export async function autorunCommand({
  task,
  config,
  logger = console,
  flags = {},
  planFn = planGenerateCommand,
  runFn = runCommandHandler,
} = {}) {
  // autorun implies unattended: default to autonomous unless the user picked a
  // level explicitly (so `kj autorun --autonomy assisted` still works).
  const autoFlags = flags.autonomy || flags.autonomous ? flags : { ...flags, autonomous: true };

  logger.info?.("kj autorun — planning…");
  const plan = await planFn({ task, config, logger, flags: autoFlags });
  if (!plan?.ok || !plan.planId) {
    logger.error?.(`kj autorun: planning failed${plan?.reason ? ` (${plan.reason})` : ""}.`);
    return { ok: false, stage: "plan", reason: plan?.reason ?? "plan-failed" };
  }

  logger.info?.(`kj autorun — running plan ${plan.ref ?? plan.planId} (${plan.huCount ?? "?"} HUs)…`);
  const run = await runFn({ config, logger, flags: { ...autoFlags, plan: plan.planId } });

  const ok = run?.ok === true;
  logger.info?.(ok ? `✓ autorun complete — plan ${plan.ref ?? plan.planId} delivered.` : `✗ autorun: some HUs did not meet the ask — see the plan board.`);
  return { ok, stage: ok ? "done" : "run", planId: plan.planId, ref: plan.ref ?? plan.planId };
}
