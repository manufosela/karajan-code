/**
 * kj plan add-hu <planId> --title "..." --type sw --deps hu_xxx
 */
export async function planAddHuCommand({ config, planId, title, type, deps, scope }) {
  const { loadPlan, savePlan } = await import("../../plan/plan-store.js");
  const { addHu } = await import("../../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const hu = addHu(plan, {
    title: title || "New HU",
    task_type: type || "sw",
    scope: scope || null,
    blocked_by: deps ? deps.split(",").map(d => d.trim()) : []
  });
  const { creatorLabel } = await import("../hu.js");
  hu.created_by = creatorLabel(); // KJC-TSK-0661: provenance stamp

  await savePlan(projectDir, plan);
  console.log(`Added: ${hu.id} — ${hu.title}`);
}
