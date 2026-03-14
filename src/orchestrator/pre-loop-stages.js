import { TriageRole } from "../roles/triage-role.js";
import { ResearcherRole } from "../roles/researcher-role.js";
import { PlannerRole } from "../roles/planner-role.js";
import { DiscoverRole } from "../roles/discover-role.js";
import { ArchitectRole } from "../roles/architect-role.js";
import { createAgent } from "../agents/index.js";
import { createArchitectADRs } from "../planning-game/architect-adrs.js";
import { addCheckpoint, markSessionStatus } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { parsePlannerOutput } from "../prompts/planner.js";
import { selectModelsForRoles } from "../utils/model-selector.js";
import { createStallDetector } from "../utils/stall-detector.js";

const ROLE_NAMES = ["planner", "researcher", "architect", "refactorer", "reviewer", "tester", "security"];

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
  emitProgress(
    emitter,
    makeEvent("triage:start", { ...eventBase, stage: "triage" }, {
      message: "Triage classifying task complexity"
    })
  );

  const triageProvider = config?.roles?.triage?.provider || coderRole.provider;
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
      detail: stageResult
    })
  );

  return { roleOverrides, stageResult };
}

export async function runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  logger.setContext({ iteration: 0, stage: "researcher" });
  emitProgress(
    emitter,
    makeEvent("researcher:start", { ...eventBase, stage: "researcher" }, {
      message: "Researcher investigating codebase"
    })
  );

  const researcherProvider = config?.roles?.researcher?.provider || coderRole.provider;
  const researcherOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "researcher" }, {
      message: line,
      detail: { stream, agent: researcherProvider }
    }));
  };
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
      message: researchOutput.ok ? "Research completed" : `Research failed: ${researchOutput.summary}`
    })
  );

  const stageResult = { ok: researchOutput.ok, summary: researchOutput.summary || null };
  const researchContext = researchOutput.ok ? researchOutput.result : null;

  return { researchContext, stageResult };
}

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
  emitProgress(
    emitter,
    makeEvent("architect:start", { ...eventBase, stage: "architect" }, {
      message: "Architect designing solution architecture"
    })
  );

  const architectProvider = config?.roles?.architect?.provider || coderRole.provider;
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
      detail: stageResult
    })
  );

  const architectContext = architectOutput.ok ? architectOutput.result : null;

  // Generate ADRs from architect tradeoffs when PG is linked
  const tradeoffs = architectOutput.result?.architecture?.tradeoffs;
  if (architectOutput.ok
    && architectOutput.result?.verdict === "ready"
    && tradeoffs?.length > 0
    && session.pg_task_id
    && session.pg_project_id) {
    try {
      const pgClient = await import("../planning-game/client.js");
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

export async function runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext, architectContext = null, triageDecomposition = null, trackBudget }) {
  const task = session.task;
  logger.setContext({ iteration: 0, stage: "planner" });
  emitProgress(
    emitter,
    makeEvent("planner:start", { ...eventBase, stage: "planner" }, {
      message: `Planner (${plannerRole.provider}) running`,
      detail: { planner: plannerRole.provider }
    })
  );

  const plannerOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "planner" }, {
      message: line,
      detail: { stream, agent: plannerRole.provider }
    }));
  };
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
        message: `Planner failed: ${details}`
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
      message: "Planner completed"
    })
  );

  return { plannedTask, stageResult };
}

export async function runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  logger.setContext({ iteration: 0, stage: "discover" });
  emitProgress(
    emitter,
    makeEvent("discover:start", { ...eventBase, stage: "discover" }, {
      message: "Discover analyzing task for gaps"
    })
  );

  const discoverProvider = config?.roles?.discover?.provider || coderRole.provider;
  const discoverOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "discover" }, {
      message: line,
      detail: { stream, agent: discoverProvider }
    }));
  };
  const discoverStall = createStallDetector({
    onOutput: discoverOnOutput, emitter, eventBase, stage: "discover", provider: discoverProvider
  });

  const mode = config?.pipeline?.discover?.mode || "gaps";
  const discover = new DiscoverRole({ config, logger, emitter });
  await discover.init({ task: session.task, sessionId: session.id, iteration: 0 });
  const discoverStart = Date.now();
  let discoverOutput;
  try {
    discoverOutput = await discover.run({ task: session.task, mode, onOutput: discoverStall.onOutput });
  } catch (err) {
    logger.warn(`Discover threw: ${err.message}`);
    discoverOutput = { ok: false, summary: `Discover error: ${err.message}`, result: { error: err.message } };
  } finally {
    discoverStall.stop();
  }
  trackBudget({
    role: "discover",
    provider: discoverProvider,
    model: config?.roles?.discover?.model || coderRole.model,
    result: discoverOutput,
    duration_ms: Date.now() - discoverStart
  });

  await addCheckpoint(session, {
    stage: "discover",
    iteration: 0,
    ok: discoverOutput.ok,
    provider: discoverProvider,
    model: config?.roles?.discover?.model || coderRole.model || null
  });

  const stageResult = {
    ok: discoverOutput.ok,
    verdict: discoverOutput.result?.verdict || null,
    gaps: discoverOutput.result?.gaps || [],
    mode
  };

  emitProgress(
    emitter,
    makeEvent("discover:end", { ...eventBase, stage: "discover" }, {
      status: discoverOutput.ok ? "ok" : "fail",
      message: discoverOutput.ok ? "Discovery completed" : `Discovery failed: ${discoverOutput.summary}`,
      detail: stageResult
    })
  );

  return { stageResult };
}
