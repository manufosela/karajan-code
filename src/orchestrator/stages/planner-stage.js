/**
 * Planner stage logic.
 * Extracted from pre-loop-stages.js for maintainability.
 */

import { PlannerRole } from "../../roles/planner-role.js";
import { createAgent } from "../../agents/index.js";
import { addCheckpoint, markSessionStatus } from "../../session-store.js";
import { emitProgress, makeEvent, emitAgentOutput } from "../../utils/events.js";
import { parsePlannerOutput } from "../../prompts/planner.js";
import { createStallDetector } from "../../utils/stall-detector.js";

export async function runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, architectContext = null, triageDecomposition = null, trackBudget }) {
  const task = session.task;
  logger.setContext({ iteration: 0, stage: "planner" });
  emitProgress(
    emitter,
    makeEvent("planner:start", { ...eventBase, stage: "planner" }, {
      message: `Planner (${plannerRole.provider}) running`,
      detail: { planner: plannerRole.provider, provider: plannerRole.provider, executorType: "agent" }
    })
  );

  const plannerOnOutput = (payload) => emitAgentOutput(emitter, eventBase, "planner", plannerRole.provider, payload);
  const plannerStall = createStallDetector({
    onOutput: plannerOnOutput, emitter, eventBase, stage: "planner", provider: plannerRole.provider
  });

  const planRole = new PlannerRole({ config, logger, emitter, createAgentFn: createAgent });
  planRole.context = { task, research: researchContext, architecture: architectContext, triageDecomposition };
  await planRole.init();
  const plannerStart = Date.now();
  let planResult;
  try {
    planResult = await planRole.execute({ task, onOutput: plannerStall.onOutput });
  } catch (err) {
    logger.warn(`Planner threw: ${err.message}`);
    planResult = { ok: false, result: { error: err.message }, summary: `Planner error: ${err.message}` };
  } finally {
    plannerStall.stop();
  }
  trackBudget({ role: "planner", provider: plannerRole.provider, model: plannerRole.model, result: planResult.result, duration_ms: Date.now() - plannerStart });
  await addCheckpoint(session, {
    stage: "planner",
    iteration: 0,
    ok: planResult.ok,
    provider: plannerRole.provider,
    model: plannerRole.model || null
  });

  if (!planResult.ok) {
    await markSessionStatus(session, "failed");
    const details = planResult.result?.error || planResult.summary || "unknown error";
    emitProgress(
      emitter,
      makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
        status: "fail",
        message: `Planner failed: ${details}`,
        detail: { provider: plannerRole.provider, executorType: "agent" }
      })
    );
    throw new Error(`Planner failed: ${details}`);
  }

  const planOutput = planResult.result?.plan || "";
  const plannedTask = planOutput ? `${task}\n\nExecution plan:\n${planOutput}` : task;
  const parsedPlan = parsePlannerOutput(planOutput);
  const stageResult = {
    ok: true,
    title: parsedPlan?.title || null,
    approach: parsedPlan?.approach || null,
    steps: parsedPlan?.steps || [],
    completedSteps: []
  };

  emitProgress(
    emitter,
    makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
      message: "Planner completed",
      detail: { provider: plannerRole.provider, executorType: "agent" }
    })
  );

  return { plannedTask, stageResult };
}
