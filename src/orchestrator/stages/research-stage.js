/**
 * Researcher stage logic.
 * Extracted from pre-loop-stages.js for maintainability.
 */

import { ResearcherRole } from "../../roles/researcher-role.js";
import { addCheckpoint } from "../../session-store.js";
import { emitProgress, makeEvent, emitAgentOutput } from "../../utils/events.js";
import { createStallDetector } from "../../utils/stall-detector.js";

export async function runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  logger.setContext({ iteration: 0, stage: "researcher" });

  const researcherProvider = config?.roles?.researcher?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("researcher:start", { ...eventBase, stage: "researcher" }, {
      message: "Researcher investigating codebase",
      detail: { researcher: researcherProvider, provider: researcherProvider, executorType: "agent" }
    })
  );

  const researcherOnOutput = (payload) => emitAgentOutput(emitter, eventBase, "researcher", researcherProvider, payload);
  const researcherStall = createStallDetector({
    onOutput: researcherOnOutput, emitter, eventBase, stage: "researcher", provider: researcherProvider
  });

  const researcher = new ResearcherRole({ config, logger, emitter });
  await researcher.init({ task: session.task });
  const researchStart = Date.now();
  let researchOutput;
  try {
    researchOutput = await researcher.run({ task: session.task, onOutput: researcherStall.onOutput });
  } catch (err) {
    logger.warn(`Researcher threw: ${err.message}`);
    researchOutput = { ok: false, summary: `Researcher error: ${err.message}`, result: { error: err.message } };
  } finally {
    researcherStall.stop();
  }
  trackBudget({
    role: "researcher",
    provider: config?.roles?.researcher?.provider || coderRole.provider,
    model: config?.roles?.researcher?.model || coderRole.model,
    result: researchOutput,
    duration_ms: Date.now() - researchStart
  });

  await addCheckpoint(session, {
    stage: "researcher",
    iteration: 0,
    ok: researchOutput.ok,
    provider: config?.roles?.researcher?.provider || coderRole.provider,
    model: config?.roles?.researcher?.model || coderRole.model || null
  });

  emitProgress(
    emitter,
    makeEvent("researcher:end", { ...eventBase, stage: "researcher" }, {
      status: researchOutput.ok ? "ok" : "fail",
      message: researchOutput.ok ? "Research completed" : `Research failed: ${researchOutput.summary}`,
      detail: { provider: researcherProvider, executorType: "agent" }
    })
  );

  const stageResult = { ok: researchOutput.ok, summary: researchOutput.summary || null };
  const researchContext = researchOutput.ok ? researchOutput.result : null;

  return { researchContext, stageResult };
}
