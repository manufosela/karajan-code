/**
 * kj plan migrate-result [--dry-run] — KJC-TSK-0394 step 4.
 * Siembra `result` en las HUs de los plan files existentes,
 * deducido del status legacy. Idempotente.
 */
import { listPlans, loadPlan, savePlan } from "../../plan/plan-store.js";
import { migratePlanResult } from "../../plan/plan-migrate-result.js";

export async function planMigrateResultCommand({ config, flags = {} }) {
  const projectDir = config.projectDir || process.cwd();
  const dryRun = !!flags.dryRun;

  const plans = await listPlans(projectDir);
  if (plans.length === 0) {
    console.log("No hay plans que migrar en este proyecto.");
    return;
  }

  let totalPlans = 0;
  let totalHus = 0;
  for (const meta of plans) {
    const plan = await loadPlan(projectDir, meta.planId);
    if (!plan) continue;
    const { plan: migrated, changes } = migratePlanResult(plan);
    if (changes.length === 0) continue;
    totalPlans += 1;
    totalHus += changes.length;
    const summary = changes
      .map((c) => `${c.huId}→${c.result ?? "null"}`)
      .join(", ");
    console.log(`${dryRun ? "[dry-run] " : ""}${meta.planId}: ${changes.length} HU(s) — ${summary}`);
    if (!dryRun) await savePlan(projectDir, migrated);
  }

  if (totalPlans === 0) {
    console.log("Todos los plans ya tienen `result` sembrado. Nada que hacer.");
  } else {
    const prefix = dryRun ? "[dry-run] " : "";
    console.log(`${prefix}Migrados ${totalHus} HU(s) en ${totalPlans} plan(s).`);
  }
}
