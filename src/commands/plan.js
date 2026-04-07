import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildPlannerPrompt } from "../prompts/planner.js";
import { parseMaybeJsonString } from "../review/parser.js";

// ---- Formatting helpers ----

function formatPlan(plan) {
  const lines = [];
  if (plan.approach) lines.push("## Approach", plan.approach, "");
  if (plan.steps?.length) {
    lines.push("## Steps");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const commit = step.commit ? ` → \`${step.commit}\`` : "";
      lines.push(`${i + 1}. ${step.description}${commit}`);
    }
    lines.push("");
  }
  if (plan.risks?.length) {
    lines.push("## Risks");
    for (const risk of plan.risks) lines.push(`- ${risk}`);
    lines.push("");
  }
  if (plan.outOfScope?.length) {
    lines.push("## Out of scope");
    for (const item of plan.outOfScope) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatHuTable(hus) {
  if (!hus?.length) return "  (no HUs)";
  const lines = [];
  const maxTitle = Math.min(50, Math.max(...hus.map(h => h.title?.length || 0)));
  lines.push(`  ${"ID".padEnd(30)} ${"Title".padEnd(maxTitle)} ${"Type".padEnd(10)} ${"Status".padEnd(10)} Deps`);
  lines.push(`  ${"─".repeat(30)} ${"─".repeat(maxTitle)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(15)}`);
  for (const hu of hus) {
    const title = (hu.title || "").slice(0, maxTitle).padEnd(maxTitle);
    const deps = (hu.blocked_by || []).join(", ") || "—";
    lines.push(`  ${hu.id.padEnd(30)} ${title} ${(hu.task_type || "sw").padEnd(10)} ${(hu.status || "?").padEnd(10)} ${deps}`);
  }
  return lines.join("\n");
}

// ---- Subcommand handlers ----

/**
 * kj plan "task" — generate plan + HUs
 */
export async function planGenerateCommand({ task, config, logger, json, context }) {
  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);

  const planner = createAgent(plannerRole.provider, config, logger);
  const prompt = buildPlannerPrompt({ task, context });
  const silenceTimeoutMs = Number(config?.session?.max_agent_silence_minutes) > 0
    ? Math.round(Number(config.session.max_agent_silence_minutes) * 60 * 1000)
    : undefined;
  const timeoutMs = Number(config?.session?.max_planner_minutes) > 0
    ? Math.round(Number(config.session.max_planner_minutes) * 60 * 1000)
    : undefined;
  const result = await planner.runTask({ prompt, role: "planner", silenceTimeoutMs, timeoutMs });

  if (!result.ok) throw new Error(result.error || result.output || "Planner failed");

  const parsed = parseMaybeJsonString(result.output);

  // Create v2 plan with HUs from planner steps
  const { createPlanV2 } = await import("../plan/plan-schema.js");
  const { addHu } = await import("../plan/plan-hu-ops.js");
  const { savePlan } = await import("../plan/plan-store.js");
  const { deriveProjectName, classifyTaskType } = await import("../hu/auto-generator.js");

  const projectDir = config.projectDir || process.cwd();
  const plan = createPlanV2(task);
  plan.name = deriveProjectName(task);
  plan.approach = parsed?.approach || (typeof parsed === "string" ? parsed : (typeof result.output === "string" ? result.output : null));
  plan.risks = parsed?.risks || [];
  plan.outOfScope = parsed?.outOfScope || [];

  // Convert planner steps → HUs
  const steps = parsed?.steps || [];
  let prevId = null;
  for (const step of steps) {
    const desc = typeof step === "string" ? step : step.description || step.title || JSON.stringify(step);
    const hu = addHu(plan, {
      title: desc.slice(0, 80),
      task_type: classifyTaskType(desc),
      scope: desc,
      blocked_by: prevId ? [prevId] : [],
      acceptance_tests: [
        "npx vitest run 2>&1; test $? -eq 0 && echo PASS || echo FAIL"
      ]
    });
    prevId = hu.id;
  }

  const planId = await savePlan(projectDir, plan);

  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (parsed?.approach) {
    console.log(formatPlan(parsed));
  } else if (plan.approach) {
    console.log(plan.approach);
  }
  console.log(`\n## HUs (${plan.hus.length})`);
  console.log(formatHuTable(plan.hus));
  console.log(`\nPlan saved: ${planId} (${plan.hus.length} HUs, status: ${plan.status})`);
  console.log(`Review:  kj plan show ${planId}`);
  console.log(`Approve: kj plan ready ${planId}`);
  console.log(`Execute: kj run --plan ${planId} "${task.slice(0, 40)}..."`);
}

/**
 * kj plan list
 */
export async function planListCommand({ config }) {
  const { listPlans } = await import("../plan/plan-store.js");
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

/**
 * kj plan show <planId>
 */
export async function planShowCommand({ config, planId }) {
  const { loadPlan } = await import("../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const plan = await loadPlan(projectDir, planId);

  if (!plan) {
    console.error(`Plan not found: ${planId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Plan: ${plan.planId}`);
  console.log(`Task: ${plan.task}`);
  console.log(`Name: ${plan.name || "—"}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Version: ${plan.version}`);
  console.log(`Created: ${plan.createdAt}`);

  if (plan.approach) {
    console.log(`\n## Approach\n${plan.approach}`);
  }

  if (plan.hus?.length > 0) {
    console.log(`\n## HUs (${plan.hus.length})`);
    console.log(formatHuTable(plan.hus));
  } else {
    console.log("\nNo HUs defined. Add with: kj plan add-hu " + planId);
  }
}

/**
 * kj plan ready <planId>
 */
export async function planReadyCommand({ config, planId }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { certifyAllHus } = await import("../plan/plan-hu-ops.js");
  const { validatePlan } = await import("../plan/plan-schema.js");
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

  const count = certifyAllHus(plan);
  await savePlan(projectDir, plan);
  console.log(`✅ ${count} HUs certified. Plan status: ready`);
  console.log(`Execute: kj run --plan ${planId} "${(plan.task || "").slice(0, 40)}..."`);
}

/**
 * kj plan validate <planId>
 */
export async function planValidateCommand({ config, planId }) {
  const { loadPlan } = await import("../plan/plan-store.js");
  const { validatePlan } = await import("../plan/plan-schema.js");
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

/**
 * kj plan delete <planId>
 */
export async function planDeleteCommand({ config, planId }) {
  const { deletePlan } = await import("../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const ok = await deletePlan(projectDir, planId);
  console.log(ok ? `Deleted: ${planId}` : `Not found: ${planId}`);
}

/**
 * kj plan add-hu <planId> --title "..." --type sw --deps hu_xxx
 */
export async function planAddHuCommand({ config, planId, title, type, deps, scope }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { addHu } = await import("../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const hu = addHu(plan, {
    title: title || "New HU",
    task_type: type || "sw",
    scope: scope || null,
    blocked_by: deps ? deps.split(",").map(d => d.trim()) : []
  });

  await savePlan(projectDir, plan);
  console.log(`Added: ${hu.id} — ${hu.title}`);
}

/**
 * kj plan remove-hu <planId> <huId>
 */
export async function planRemoveHuCommand({ config, planId, huId }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { removeHu } = await import("../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const ok = removeHu(plan, huId);
  if (!ok) { console.error(`HU not found: ${huId}`); process.exitCode = 1; return; }

  await savePlan(projectDir, plan);
  console.log(`Removed: ${huId}`);
}

// Keep backward compat — old callers import planCommand
export const planCommand = planGenerateCommand;
