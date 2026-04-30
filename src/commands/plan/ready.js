/**
 * kj plan ready <planId>
 */
export async function planReadyCommand({ config, planId }) {
  const { loadPlan, savePlan } = await import("../../plan/plan-store.js");
  const { certifyAllHus } = await import("../../plan/plan-hu-ops.js");
  const { validatePlan } = await import("../../plan/plan-schema.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const validation = validatePlan(plan);
  if (!validation.valid) {
    console.error("Plan validation failed:");
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
    return;
  }

  if (plan.hus.length === 0) {
    console.error("Cannot approve a plan with 0 HUs.");
    process.exitCode = 1;
    return;
  }

  // Tests-first gate: refuse to certify HUs that have no acceptance_tests.
  // A "ready" plan must have an executable test contract per HU, otherwise
  // the coder has nothing to aim for. Flag each offender, then bail so the
  // user can edit the plan (board ✎ Edit or `kj plan add-hu`) and retry.
  const missing = plan.hus.filter((h) => !Array.isArray(h.acceptance_tests) || h.acceptance_tests.length === 0);
  if (missing.length > 0) {
    console.error(`Cannot mark ready: ${missing.length}/${plan.hus.length} HU(s) have no acceptance_tests:`);
    for (const h of missing) console.error(`  - ${h.id}  ${(h.title || "").slice(0, 60)}`);
    console.error("");
    console.error("Tests-first flow requires a test contract per HU. Edit each HU on the board");
    console.error("(http://localhost:4000) via the ✎ Edit button, or re-run `kj plan` to regenerate.");
    process.exitCode = 1;
    return;
  }

  const count = certifyAllHus(plan);
  await savePlan(projectDir, plan);
  console.log(`✅ ${count} HUs certified. Plan status: ready`);
  console.log(`Run: kj run --plan ${planId} "${(plan.task || "").slice(0, 40)}..."`);
}
