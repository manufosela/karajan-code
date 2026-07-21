/**
 * `kj hu add|move|list` (AB-H, KJC-TSK-0658) — board writes for the brain.
 * The v4 playbook orders "card first", but until now only the headless
 * planner could create HUs. These commands operate on a per-project
 * "brain-backlog" plan (created on first use) so any host agent can track
 * work in the HU Board without the subprocess pipeline.
 */
import { addHu, updateHuStatus } from "../plan/plan-hu-ops.js";
import { generatePlanId } from "../plan/plan-id.js";
import { savePlan, listPlans, loadPlan } from "../plan/plan-store.js";

export const HU_STATUSES = ["pending", "running", "done", "failed", "skipped"];
const BACKLOG_NAME = "brain-backlog";

async function backlogPlan(projectDir) {
  const plans = await listPlans(projectDir);
  const existing = plans.find((p) => p.alias === BACKLOG_NAME || p.name === BACKLOG_NAME);
  if (existing) return loadPlan(projectDir, existing.planId);
  const plan = {
    version: 2, planId: generatePlanId(), name: BACKLOG_NAME,
    task: "Host-agent tracked work (v4 environment)",
    status: "ready", hus: [], createdAt: new Date().toISOString(),
  };
  const planId = await savePlan(projectDir, plan);
  return loadPlan(projectDir, planId);
}

export async function huCommand({ config = null, action, args = [], flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const emit = (obj, human) => { console.log(flags.json ? JSON.stringify(obj) : human); return obj; };

  if (action === "list") {
    const plans = await listPlans(projectDir);
    const rows = [];
    for (const meta of plans) {
      const plan = await loadPlan(projectDir, meta.planId);
      for (const h of plan.hus || []) {
        rows.push({ id: h.id, short_id: h.short_id, title: h.title, status: h.status, plan: plan.alias || plan.planId });
      }
    }
    if (flags.json) { console.log(JSON.stringify(rows)); return rows; }
    for (const r of rows) console.log(`${(r.short_id || r.id).padEnd(28)} ${r.status.padEnd(8)} ${r.title}`);
    if (rows.length === 0) console.log("no HUs yet — create one with: kj hu add \"<story>\"");
    return rows;
  }

  if (action === "add") {
    const title = args[0];
    if (!title || !title.trim()) throw new Error("kj hu add requires a title: kj hu add \"<story>\"");
    const plan = await backlogPlan(projectDir);
    const hu = addHu(plan, {
      title,
      short_id: flags.id || null,
      acceptance_criteria: flags.criteria ? [flags.criteria] : [],
    });
    await savePlan(projectDir, plan);
    return emit({ id: hu.id, short_id: hu.short_id, status: hu.status },
      `✓ HU created: ${hu.short_id || hu.id} (pending) — it shows up in \`kj board\``);
  }

  if (action === "move") {
    const [ref, status] = args;
    if (!ref || !status) throw new Error("usage: kj hu move <id> <status>");
    if (!HU_STATUSES.includes(status)) {
      throw new Error(`invalid status "${status}" — valid: ${HU_STATUSES.join(", ")}`);
    }
    // Exact canonical id wins outright (it IS the disambiguator); only then
    // fall back to short_id matches — which can repeat between plans, so
    // silently moving the first hit could move the wrong card.
    const byId = [];
    const byShort = [];
    for (const meta of await listPlans(projectDir)) {
      const plan = await loadPlan(projectDir, meta.planId);
      for (const hu of plan.hus || []) {
        if (hu.id === ref) byId.push({ plan, hu });
        else if (hu.short_id === ref) byShort.push({ plan, hu });
      }
    }
    const matches = byId.length > 0 ? byId : byShort;
    if (matches.length === 0) throw new Error(`HU "${ref}" not found — see kj hu list`);
    if (matches.length > 1) {
      const ids = matches.map((m) => m.hu.id).join(", ");
      throw new Error(`"${ref}" is ambiguous (${matches.length} matches: ${ids}) — use the full id`);
    }
    const { plan, hu } = matches[0];
    updateHuStatus(plan, hu.id, status);
    await savePlan(projectDir, plan);
    return emit({ id: hu.id, status }, `✓ ${hu.short_id || hu.id} → ${status}`);
  }

  throw new Error(`unknown action "${action}" — use: add | move | list`);
}
