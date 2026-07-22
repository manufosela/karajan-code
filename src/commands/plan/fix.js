// KJC-TSK-0402: relanzar el self-fix loop sobre un plan ya generado,
// opcionalmente con feedback humano que guía al reviewer hacia los
// puntos débiles que la primera pasada no detectó. NO regenera desde
// cero — preserva el trabajo previo.

import { createAgent } from "../../agents/index.js";
import { assertAgentsAvailable } from "../../agents/availability.js";
import { resolveRole } from "../../config.js";
import { createCliProgressReporter } from "../../utils/cli-progress.js";
import { reviewPlan, findingsCount, findingsCountByType } from "../../plan/plan-reviewer.js";
import { applyReviewerFeedback, applyFixerPatch } from "../../plan/plan-fixer.js";
import { runStructuralPass } from "../../plan/plan-structural-pass.js";
import { loadPlan, savePlan } from "../../plan/plan-store.js";

export async function planFixCommand({ config, planId, prompt, logger, json }) {
  const projectDir = config.projectDir || process.cwd();
  const plan = await loadPlan(projectDir, planId);
  if (!plan) throw new Error(`Plan no encontrado: ${planId}`);
  if (!Array.isArray(plan.hus) || plan.hus.length === 0) {
    throw new Error(`Plan ${planId} no tiene HUs.`);
  }

  const before = { hus: plan.hus.length, deps: plan.hus.reduce((a, h) => a + (h.blocked_by?.length || 0), 0) };

  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);
  const planner = createAgent(plannerRole.provider, config, logger);
  const silenceTimeoutMs = Number(config?.session?.max_agent_silence_minutes) > 0
    ? Math.round(Number(config.session.max_agent_silence_minutes) * 60 * 1000) : undefined;
  const timeoutMs = Number(config?.session?.max_planner_minutes) > 0
    ? Math.round(Number(config.session.max_planner_minutes) * 60 * 1000) : undefined;

  // Reviewer con prompt opcional del usuario inyectado como contexto extra.
  // El prompt se prepende al task original para que el reviewer LLM lo lea
  // antes de la HU list.
  const enrichedTask = prompt
    ? `${plan.task || ""}\n\n## USER FEEDBACK (priorizar estos puntos)\n${prompt}\n`
    : plan.task || "";

  const reviewProgress = createCliProgressReporter({ role: "plan-fix:reviewer", quiet: Boolean(json) });
  const review = await reviewPlan({
    agent: planner, task: enrichedTask, hus: plan.hus,
    onOutput: reviewProgress.onOutput, silenceTimeoutMs, timeoutMs,
  });
  reviewProgress.finish(review.ok ? "done" : "failed");
  if (!review.ok) throw new Error(`Reviewer falló: ${review.error}`);
  plan.review = review.findings;
  let count = findingsCount(review.findings);
  if (!json) process.stderr.write(`Reviewer encontró ${count} item(s).\n`);

  // Self-fix loop con smart convergence guard (mismo que generate.js).
  const maxIter = 4;
  for (let i = 1; i <= maxIter && count > 0; i++) {
    const husSnapshot = JSON.parse(JSON.stringify(plan.hus));
    const reviewSnapshot = JSON.parse(JSON.stringify(plan.review));
    const fixProgress = createCliProgressReporter({ role: `plan-fix:iter ${i}`, quiet: Boolean(json) });
    const fix = await applyReviewerFeedback({
      agent: planner, task: enrichedTask, hus: plan.hus, findings: plan.review,
      onOutput: fixProgress.onOutput, silenceTimeoutMs, timeoutMs,
    });
    if (!fix.ok) { fixProgress.finish("failed"); break; }
    const ops = applyFixerPatch(plan, fix.patch);
    if (ops.added + ops.depsAdded + ops.archived === 0) { fixProgress.finish("done"); break; }
    const review2 = await reviewPlan({
      agent: planner, task: enrichedTask, hus: plan.hus,
      onOutput: fixProgress.onOutput, silenceTimeoutMs, timeoutMs,
    });
    if (!review2.ok) { plan.hus = husSnapshot; plan.review = reviewSnapshot; fixProgress.finish("failed"); break; }
    const b = findingsCountByType(reviewSnapshot);
    const a = findingsCountByType(review2.findings);
    const accept = a.priority < b.priority || (a.priority === b.priority && a.total <= b.total);
    if (!accept) { plan.hus = husSnapshot; plan.review = reviewSnapshot; fixProgress.finish("reverted"); break; }
    plan.review = review2.findings;
    count = a.total;
    fixProgress.finish("done");
  }

  // Structural integrity pass determinístico al final.
  const { fixes: structuralFixes } = runStructuralPass(plan);
  if (structuralFixes.length > 0) {
    if (!plan.review) plan.review = {};
    plan.review.structural_fixes = structuralFixes;
  }

  await savePlan(projectDir, plan);
  const after = { hus: plan.hus.length, deps: plan.hus.reduce((a, h) => a + (h.blocked_by?.length || 0), 0) };

  if (json) {
    console.log(JSON.stringify({ planId, before, after, structuralFixes }, null, 2));
    return;
  }
  const diffHus = after.hus - before.hus;
  const diffDeps = after.deps - before.deps;
  const structuralSummary = structuralFixes.length > 0
    ? `, ${structuralFixes.length} structural fix(es)` : "";
  console.log(
    `kj plan fix ${planId}: ${diffHus >= 0 ? "+" : ""}${diffHus} HUs, ${diffDeps >= 0 ? "+" : ""}${diffDeps} deps${structuralSummary}. Findings: ${count} restantes.`
  );
}
