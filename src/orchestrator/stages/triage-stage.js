/**
 * Triage stage logic.
 * Extracted from pre-loop-stages.js for maintainability.
 */

import { TriageRole } from "../../roles/triage-role.js";
import { addCheckpoint } from "../../session-store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { selectModelsForRoles } from "../../utils/model-selector.js";
import { createStallDetector } from "../../utils/stall-detector.js";

const ROLE_NAMES = ["planner", "researcher", "architect", "refactorer", "reviewer", "tester", "security", "impeccable"];

function buildRoleOverrides(recommendedRoles, pipelineConfig) {
  const overrides = {};
  for (const role of ROLE_NAMES) {
    overrides[`${role}Enabled`] = recommendedRoles.has(role) || Boolean(pipelineConfig[role]?.enabled);
  }
  return overrides;
}

function applyModelSelection(triageOutput, config, emitter, eventBase) {
  if (!triageOutput.ok || !config?.model_selection?.enabled) return null;
  const level = triageOutput.result?.level;
  if (!level) return null;

  const { modelOverrides, reasoning } = selectModelsForRoles({ level, config });
  for (const [role, model] of Object.entries(modelOverrides)) {
    if (config.roles?.[role] && !config.roles[role].model) {
      config.roles[role].model = model;
    }
  }
  const modelSelection = { modelOverrides, reasoning };
  emitProgress(
    emitter,
    makeEvent("model-selection:applied", { ...eventBase, stage: "triage" }, {
      message: "Smart model selection applied",
      detail: modelSelection
    })
  );
  return modelSelection;
}

export async function runTriageStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  logger.setContext({ iteration: 0, stage: "triage" });

  const triageProvider = config?.roles?.triage?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("triage:start", { ...eventBase, stage: "triage" }, {
      message: "Triage classifying task complexity",
      detail: { provider: triageProvider, executorType: "agent" }
    })
  );

  const triageOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "triage" }, {
      message: line,
      detail: { stream, agent: triageProvider }
    }));
  };
  const triageStall = createStallDetector({
    onOutput: triageOnOutput, emitter, eventBase, stage: "triage", provider: triageProvider
  });

  const triage = new TriageRole({ config, logger, emitter });
  await triage.init({ task: session.task, sessionId: session.id, iteration: 0 });
  const triageStart = Date.now();
  let triageOutput;
  try {
    triageOutput = await triage.run({ task: session.task, onOutput: triageStall.onOutput });
  } catch (err) {
    logger.warn(`Triage threw: ${err.message}`);
    triageOutput = { ok: false, summary: `Triage error: ${err.message}`, result: { error: err.message } };
  } finally {
    triageStall.stop();
  }
  trackBudget({
    role: "triage",
    provider: config?.roles?.triage?.provider || coderRole.provider,
    model: config?.roles?.triage?.model || coderRole.model,
    result: triageOutput,
    duration_ms: Date.now() - triageStart
  });

  await addCheckpoint(session, {
    stage: "triage",
    iteration: 0,
    ok: triageOutput.ok,
    provider: config?.roles?.triage?.provider || coderRole.provider,
    model: config?.roles?.triage?.model || coderRole.model || null
  });

  const recommendedRoles = new Set(triageOutput.result?.roles || []);
  const roleOverrides = triageOutput.ok
    ? buildRoleOverrides(recommendedRoles, config.pipeline || {})
    : {};

  const shouldDecompose = triageOutput.result?.shouldDecompose || false;
  const subtasks = triageOutput.result?.subtasks || [];

  const stageResult = {
    ok: triageOutput.ok,
    level: triageOutput.result?.level || null,
    roles: Array.from(recommendedRoles),
    reasoning: triageOutput.result?.reasoning || null,
    taskType: triageOutput.result?.taskType || "sw",
    shouldDecompose,
    subtasks
  };

  const modelSelection = applyModelSelection(triageOutput, config, emitter, eventBase);
  if (modelSelection) {
    stageResult.modelSelection = modelSelection;
  }

  if (shouldDecompose && subtasks.length > 0) {
    emitProgress(
      emitter,
      makeEvent("triage:decompose", { ...eventBase, stage: "triage" }, {
        message: `Task decomposition recommended: ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}`,
        detail: { shouldDecompose, subtasks }
      })
    );
  }

  emitProgress(
    emitter,
    makeEvent("triage:end", { ...eventBase, stage: "triage" }, {
      status: triageOutput.ok ? "ok" : "fail",
      message: triageOutput.ok ? "Triage completed" : `Triage failed: ${triageOutput.summary}`,
      detail: { ...stageResult, provider: triageProvider, executorType: "agent" }
    })
  );

  return { roleOverrides, stageResult };
}
