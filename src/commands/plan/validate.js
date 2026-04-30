/**
 * kj plan validate <planId>
 */
export async function planValidateCommand({ config, planId }) {
  const { loadPlan } = await import("../../plan/plan-store.js");
  const { validatePlan } = await import("../../plan/plan-schema.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const result = validatePlan(plan);
  if (result.valid) {
    console.log(`✅ Plan ${planId} is valid (${plan.hus.length} HUs, status: ${plan.status})`);
  } else {
    console.error(`❌ Plan ${planId} has ${result.errors.length} error(s):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
  }
}
