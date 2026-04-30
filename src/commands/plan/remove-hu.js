/**
 * kj plan remove-hu <planId> <huId>
 */
export async function planRemoveHuCommand({ config, planId, huId }) {
  const { loadPlan, savePlan } = await import("../../plan/plan-store.js");
  const { removeHu } = await import("../../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const ok = removeHu(plan, huId);
  if (!ok) { console.error(`HU not found: ${huId}`); process.exitCode = 1; return; }

  await savePlan(projectDir, plan);
  console.log(`Removed: ${huId}`);
}
