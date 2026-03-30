/**
 * Architect stage logic.
 * Extracted from pre-loop-stages.js for maintainability.
 */

import { ArchitectRole } from "../../roles/architect-role.js";
import { createAgent } from "../../agents/index.js";
import { createArchitectADRs } from "../../planning-game/architect-adrs.js";
import { addCheckpoint } from "../../session-store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { createStallDetector } from "../../utils/stall-detector.js";

async function handleArchitectClarification({ architectOutput, askQuestion, config, logger, emitter, eventBase, session, architectOnOutput, architectProvider, coderRole, researchContext, discoverResult, triageLevel, trackBudget }) {
  if (!architectOutput.ok
    || architectOutput.result?.verdict !== "needs_clarification"
    || !architectOutput.result?.questions?.length) {
    return architectOutput;
  }

  const questions = architectOutput.result.questions;
  if (!askQuestion) {
    logger.warn("Architect returned needs_clarification but no interactive input available — continuing with best-effort decisions");
    return architectOutput;
  }

  const formatted = "The architect needs clarification before proceeding:\n\n"
    + questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    + "\n\nPlease provide your answers:";

  emitProgress(
    emitter,
    makeEvent("architect:clarification", { ...eventBase, stage: "architect" }, {
      message: "Architect needs clarification — pausing for human input",
      detail: { questions }
    })
  );

  const answer = await askQuestion(formatted, { iteration: 0, stage: "architect" });
  if (!answer) return architectOutput;

  const architect2 = new ArchitectRole({ config, logger, emitter, createAgentFn: createAgent });
  await architect2.init({ task: session.task, sessionId: session.id, iteration: 0 });
  const rerunStart = Date.now();
  const rerunStall = createStallDetector({
    onOutput: architectOnOutput, emitter, eventBase, stage: "architect", provider: architectProvider
  });
  let result;
  try {
    result = await architect2.execute({
      task: session.task,
      onOutput: rerunStall.onOutput,
      researchContext,
      discoverResult,
      triageLevel,
      humanAnswers: answer
    });
  } finally {
    rerunStall.stop();
  }
  trackBudget({
    role: "architect",
    provider: architectProvider,
    model: config?.roles?.architect?.model || coderRole.model,
    result,
    duration_ms: Date.now() - rerunStart
  });
  return result;
}

export async function runArchitectStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, researchContext = null, discoverResult = null, triageLevel = null, askQuestion = null }) {
  logger.setContext({ iteration: 0, stage: "architect" });
  const architectProvider = config?.roles?.architect?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("architect:start", { ...eventBase, stage: "architect" }, {
      message: "Architect designing solution architecture",
      detail: { architect: architectProvider, provider: architectProvider, executorType: "agent" }
    })
  );
  const architectOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "architect" }, {
      message: line,
      detail: { stream, agent: architectProvider }
    }));
  };
  const architectStall = createStallDetector({
    onOutput: architectOnOutput, emitter, eventBase, stage: "architect", provider: architectProvider
  });

  const architect = new ArchitectRole({ config, logger, emitter, createAgentFn: createAgent });
  await architect.init({ task: session.task, sessionId: session.id, iteration: 0 });
  const architectStart = Date.now();
  let architectOutput;
  try {
    architectOutput = await architect.execute({
      task: session.task,
      onOutput: architectStall.onOutput,
      researchContext,
      discoverResult,
      triageLevel
    });
  } catch (err) {
    logger.warn(`Architect threw: ${err.message}`);
    architectOutput = { ok: false, summary: `Architect error: ${err.message}`, result: { error: err.message } };
  } finally {
    architectStall.stop();
  }
  trackBudget({
    role: "architect",
    provider: architectProvider,
    model: config?.roles?.architect?.model || coderRole.model,
    result: architectOutput,
    duration_ms: Date.now() - architectStart
  });

  await addCheckpoint(session, {
    stage: "architect",
    iteration: 0,
    ok: architectOutput.ok,
    provider: architectProvider,
    model: config?.roles?.architect?.model || coderRole.model || null
  });

  // --- Interactive clarification loop ---
  architectOutput = await handleArchitectClarification({
    architectOutput, askQuestion, config, logger, emitter, eventBase, session,
    architectOnOutput, architectProvider, coderRole, researchContext, discoverResult, triageLevel, trackBudget
  });

  const stageResult = {
    ok: architectOutput.ok,
    verdict: architectOutput.result?.verdict || null,
    architecture: architectOutput.result?.architecture || null,
    questions: architectOutput.result?.questions || []
  };

  emitProgress(
    emitter,
    makeEvent("architect:end", { ...eventBase, stage: "architect" }, {
      status: architectOutput.ok ? "ok" : "fail",
      message: architectOutput.ok ? "Architecture completed" : `Architecture failed: ${architectOutput.summary}`,
      detail: { ...stageResult, provider: architectProvider, executorType: "agent" }
    })
  );

  const architectContext = architectOutput.ok ? architectOutput.result : null;

  // TODO: Move ADR creation to planning-game/pipeline-adapter.js (PG coupling still here because
  // stageResult.adrs is consumed synchronously within runArchitectStage's return value).
  // Generate ADRs from architect tradeoffs when PG is linked
  const tradeoffs = architectOutput.result?.architecture?.tradeoffs;
  if (architectOutput.ok
    && architectOutput.result?.verdict === "ready"
    && tradeoffs?.length > 0
    && session.pg_task_id
    && session.pg_project_id) {
    try {
      const pgClient = await import("../../planning-game/client.js");
      const adrResult = await createArchitectADRs({
        tradeoffs,
        pgTaskId: session.pg_task_id,
        pgProject: session.pg_project_id,
        taskTitle: session.task,
        mcpClient: pgClient
      });
      stageResult.adrs = adrResult;
      if (adrResult.created > 0) {
        logger.info(`Architect: created ${adrResult.created} ADR(s) in Planning Game`);
      }
    } catch (err) {
      logger.warn(`Architect: failed to create ADRs: ${err.message}`);
    }
  }

  return { architectContext, stageResult };
}
