/**
 * kj plan list
 */
export async function planListCommand({ config }) {
  const { listPlans } = await import("../../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const plans = await listPlans(projectDir);

  if (plans.length === 0) {
    console.log("No plans found. Create one with: kj plan \"your task\"");
    return;
  }

  console.log(`Plans for ${projectDir}:\n`);
  for (const p of plans) {
    const husInfo = p.huCount > 0 ? ` (${p.huCount} HUs)` : "";
    const status = p.status !== "draft" ? ` [${p.status}]` : "";
    console.log(`  ${p.planId}  ${(p.name || p.task || "").slice(0, 50)}${husInfo}${status}`);
    console.log(`    Created: ${p.createdAt}`);
  }
}
