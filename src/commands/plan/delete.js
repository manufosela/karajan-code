/**
 * kj plan delete <planId>
 */
export async function planDeleteCommand({ config, planId }) {
  const { deletePlan } = await import("../../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const ok = await deletePlan(projectDir, planId);
  console.log(ok ? `Deleted: ${planId}` : `Not found: ${planId}`);
}
