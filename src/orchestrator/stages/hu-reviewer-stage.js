/**
 * HU Reviewer stage logic + splitting logic.
 * Extracted from pre-loop-stages.js for maintainability.
 */

import { DiscoverRole } from "../../roles/discover-role.js";
import { HuReviewerRole } from "../../roles/hu-reviewer-role.js";
import { createAgent } from "../../agents/index.js";
import { addCheckpoint } from "../../session-store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { buildDecompositionPrompt, parseDecompositionOutput } from "../../prompts/hu-reviewer.js";
import { createStallDetector } from "../../utils/stall-detector.js";
import { createHuBatch, loadHuBatch, saveHuBatch, updateStoryStatus, updateStoryQuality, updateStoryCertified, addContextRequest, answerContextRequest } from "../../hu/store.js";
import { topologicalSort } from "../../hu/graph.js";
import { detectIndicators, selectHeuristic } from "../../hu/splitting-detector.js";
import { generateSplitProposal, formatSplitProposalForFDE, buildSplitDependencies } from "../../hu/splitting-generator.js";

/**
 * Use an AI agent to decompose a complex task into multiple formal HUs.
 * Returns null if decomposition fails or the task is too simple.
 */
async function decomposeTaskIntoHUs({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  const provider = config?.roles?.hu_reviewer?.provider || coderRole.provider;
  const prompt = buildDecompositionPrompt(session.task);

  emitProgress(
    emitter,
    makeEvent("hu-reviewer:decompose-start", { ...eventBase, stage: "hu-reviewer" }, {
      message: "Decomposing complex task into formal HUs",
      detail: { provider }
    })
  );

  const onOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "hu-reviewer" }, {
      message: line,
      detail: { stream, agent: provider }
    }));
  };
  const stall = createStallDetector({
    onOutput, emitter, eventBase, stage: "hu-reviewer", provider
  });

  const agent = createAgent(provider, config, logger);
  const decompStart = Date.now();
  let result;
  try {
    result = await agent.runTask({ prompt, role: "hu-reviewer", onOutput: stall.onOutput });
  } catch (err) {
    logger.warn(`HU decomposition threw: ${err.message}`);
    return null;
  } finally {
    stall.stop();
  }

  trackBudget({
    role: "hu-reviewer-decompose",
    provider,
    model: config?.roles?.hu_reviewer?.model || coderRole.model,
    result,
    duration_ms: Date.now() - decompStart
  });

  if (!result.ok) {
    logger.warn(`HU decomposition failed: ${result.error || "unknown"}`);
    return null;
  }

  const stories = parseDecompositionOutput(result.output);
  if (!stories || stories.length < 2) {
    logger.info("HU decomposition returned < 2 stories, falling back to single auto-story");
    return null;
  }

  emitProgress(
    emitter,
    makeEvent("hu-reviewer:decompose-end", { ...eventBase, stage: "hu-reviewer" }, {
      message: `Task decomposed into ${stories.length} HUs`,
      detail: { count: stories.length, ids: stories.map(s => s.id) }
    })
  );

  return stories;
}

export async function runDiscoverStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget }) {
  logger.setContext({ iteration: 0, stage: "discover" });
  const discoverProvider = config?.roles?.discover?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("discover:start", { ...eventBase, stage: "discover" }, {
      message: "Discover analyzing task for gaps",
      detail: { discover: discoverProvider, provider: discoverProvider, executorType: "agent" }
    })
  );
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
      detail: { ...stageResult, provider: discoverProvider, executorType: "agent" }
    })
  );

  return { stageResult };
}

/**
 * Run the HU Reviewer stage: load stories from YAML or generate from task, evaluate, certify, and return in topological order.
 */
export async function runHuReviewerStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, huFile, askQuestion, pgStories = null }) {
  logger.setContext({ iteration: 0, stage: "hu-reviewer" });
  const huReviewerProvider = config?.roles?.hu_reviewer?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("hu-reviewer:start", { ...eventBase, stage: "hu-reviewer" }, {
      message: "HU Reviewer certifying user stories",
      detail: { provider: huReviewerProvider, executorType: "agent" }
    })
  );

  let stories;

  if (huFile) {
    // --- Load YAML file ---
    const yaml = await import("js-yaml");
    const fs = await import("node:fs/promises");
    let rawYaml;
    try {
      rawYaml = await fs.readFile(huFile, "utf8");
    } catch (err) {
      const stageResult = { ok: false, error: `Could not read HU file: ${err.message}` };
      emitProgress(emitter, makeEvent("hu-reviewer:end", { ...eventBase, stage: "hu-reviewer" }, {
        status: "fail", message: stageResult.error
      }));
      return { stageResult };
    }

    try {
      const parsed = yaml.load(rawYaml);
      stories = Array.isArray(parsed) ? parsed : (parsed?.stories || []);
    } catch (err) {
      const stageResult = { ok: false, error: `Invalid YAML in HU file: ${err.message}` };
      emitProgress(emitter, makeEvent("hu-reviewer:end", { ...eventBase, stage: "hu-reviewer" }, {
        status: "fail", message: stageResult.error
      }));
      return { stageResult };
    }
  } else if (pgStories && pgStories.length > 0) {
    // --- Use pre-built stories from Planning Game card structured data ---
    stories = pgStories;
    logger.info(`HU Reviewer: using ${pgStories.length} story(ies) from PG card`);
    emitProgress(emitter, makeEvent("hu-reviewer:pg-feed", { ...eventBase, stage: "hu-reviewer" }, {
      message: `Using ${pgStories.length} story(ies) from Planning Game card`,
      detail: { source: "pg-card", storyIds: pgStories.map(s => s.id) }
    }));
  } else {
    // --- Decompose task into formal HUs via AI, or fall back to single auto-story ---
    const decomposed = await decomposeTaskIntoHUs({
      config, logger, emitter, eventBase, session, coderRole, trackBudget
    });
    if (decomposed && decomposed.length > 1) {
      stories = decomposed.map((hu, idx) => {
        const isFirst = idx === 0;
        const fullText = `As a ${hu.role}, I want to ${hu.goal}, so that ${hu.benefit}\n\nTitle: ${hu.title}\nAcceptance Criteria:\n${hu.acceptanceCriteria.map(ac => `- ${ac}`).join("\n")}`;
        const skeletonText = `As a ${hu.role}, I want to ${hu.goal}, so that ${hu.benefit}\n\nTitle: ${hu.title}`;
        return {
          id: hu.id,
          text: isFirst ? fullText : skeletonText,
          blocked_by: hu.dependsOn || [],
          needsRefinement: !isFirst
        };
      });
    } else {
      stories = [{ id: "HU-AUTO-001", text: session.task }];
    }
  }

  if (stories.length === 0) {
    const stageResult = { ok: true, certified: 0, stories: [] };
    emitProgress(emitter, makeEvent("hu-reviewer:end", { ...eventBase, stage: "hu-reviewer" }, {
      status: "ok", message: "No stories to evaluate"
    }));
    return { stageResult };
  }

  // --- Create or load batch ---
  const batchSessionId = `hu-${session.id}`;
  let batch;
  try {
    batch = await loadHuBatch(batchSessionId);
  } catch { /* no existing batch */
    batch = await createHuBatch(batchSessionId, stories);
  }

  // --- Splitting detection: check each pending HU for split indicators before 6D evaluation ---
  const storiesToSplit = [...batch.stories].filter(s => s.status === "pending");
  for (const story of storiesToSplit) {
    const indicators = detectIndicators(story.original.text);
    if (indicators.length === 0) continue;

    let heuristic = selectHeuristic(indicators);
    if (!heuristic) continue;

    const triedHeuristics = [];
    let splitAccepted = false;

    while (heuristic && !splitAccepted) {
      const proposal = await generateSplitProposal(
        { id: story.id, text: story.original.text },
        heuristic, config, logger
      );

      if (!proposal) {
        triedHeuristics.push(heuristic);
        heuristic = selectHeuristic(indicators, triedHeuristics);
        continue;
      }

      if (!askQuestion) {
        // Autonomous mode: auto-accept the split
        const updatedSubHUs = buildSplitDependencies(proposal.subHUs, story);
        const storyIndex = batch.stories.findIndex(s => s.id === story.id);
        const newStories = updatedSubHUs.map(sub => ({
          id: sub.id, status: "pending",
          original: { text: `${sub.title}\n\n${sub.text}\n\nAcceptance Criteria:\n${(sub.acceptanceCriteria || []).map(ac => `- ${ac}`).join("\n")}` },
          blocked_by: sub.blocked_by || [], certified: null, quality: null,
          context_requests: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }));
        batch.stories.splice(storyIndex, 1, ...newStories);
        splitAccepted = true;
        emitProgress(emitter, makeEvent("hu-reviewer:split-accepted", { ...eventBase, stage: "hu-reviewer" }, {
          message: `Auto-accepted split of ${story.id} into ${updatedSubHUs.length} sub-HUs`,
          detail: { originalId: story.id, subHUs: updatedSubHUs.map(s => s.id), heuristic }
        }));
      } else {
        // Interactive mode: ask FDE for confirmation
        const formatted = formatSplitProposalForFDE(proposal);
        const question = `Split proposed for ${story.id}:\n${formatted}\nAccept? (yes/no/try another)`;
        emitProgress(emitter, makeEvent("hu-reviewer:split-proposal", { ...eventBase, stage: "hu-reviewer" }, {
          message: `Split proposal for ${story.id} using heuristic: ${heuristic}`,
          detail: { originalId: story.id, heuristic, subHUCount: proposal.subHUs.length }
        }));
        const answer = await askQuestion(question, { iteration: 0, stage: "hu-reviewer" });
        if (!answer || answer.toLowerCase().startsWith("yes")) {
          const updatedSubHUs = buildSplitDependencies(proposal.subHUs, story);
          const storyIndex = batch.stories.findIndex(s => s.id === story.id);
          const newStories = updatedSubHUs.map(sub => ({
            id: sub.id, status: "pending",
            original: { text: `${sub.title}\n\n${sub.text}\n\nAcceptance Criteria:\n${(sub.acceptanceCriteria || []).map(ac => `- ${ac}`).join("\n")}` },
            blocked_by: sub.blocked_by || [], certified: null, quality: null,
            context_requests: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()
          }));
          batch.stories.splice(storyIndex, 1, ...newStories);
          splitAccepted = true;
          emitProgress(emitter, makeEvent("hu-reviewer:split-accepted", { ...eventBase, stage: "hu-reviewer" }, {
            message: `FDE accepted split of ${story.id} into ${updatedSubHUs.length} sub-HUs`,
            detail: { originalId: story.id, subHUs: updatedSubHUs.map(s => s.id), heuristic }
          }));
        } else if (answer.toLowerCase().includes("try") || answer.toLowerCase().startsWith("no")) {
          triedHeuristics.push(heuristic);
          heuristic = selectHeuristic(indicators, triedHeuristics);
          if (!heuristic) {
            updateStoryStatus(batch, story.id, "needs_context");
          }
          continue;
        }
      }
      break;
    }
    await saveHuBatch(batchSessionId, batch);
  }

  // --- Evaluate loop (re-evaluate entire batch until all certified or needs_context with no askQuestion) ---
  const huReviewerOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "hu-reviewer" }, {
      message: line,
      detail: { stream, agent: huReviewerProvider }
    }));
  };

  let maxRounds = 5;
  let round = 0;

  while (round < maxRounds) {
    round += 1;

    const pendingStories = batch.stories.filter(s => s.status === "pending" || s.status === "needs_context");
    if (pendingStories.length === 0) break;

    const storiesToEvaluate = pendingStories.map(s => ({ id: s.id, text: s.original.text }));

    const stall = createStallDetector({
      onOutput: huReviewerOnOutput, emitter, eventBase, stage: "hu-reviewer", provider: huReviewerProvider
    });

    const huReviewer = new HuReviewerRole({ config, logger, emitter, createAgentFn: createAgent });
    await huReviewer.init({ task: session.task, sessionId: session.id, iteration: 0 });
    const reviewStart = Date.now();
    let reviewOutput;
    try {
      reviewOutput = await huReviewer.run({ stories: storiesToEvaluate, onOutput: stall.onOutput });
    } catch (err) {
      logger.warn(`HU Reviewer threw: ${err.message}`);
      reviewOutput = { ok: false, summary: `HU Reviewer error: ${err.message}`, result: { error: err.message } };
    } finally {
      stall.stop();
    }

    trackBudget({
      role: "hu-reviewer",
      provider: huReviewerProvider,
      model: config?.roles?.hu_reviewer?.model || coderRole.model,
      result: reviewOutput,
      duration_ms: Date.now() - reviewStart
    });

    if (!reviewOutput.ok || !reviewOutput.result?.evaluations) {
      break;
    }

    // --- Process evaluations ---
    for (const evaluation of reviewOutput.result.evaluations) {
      const storyId = evaluation.story_id;
      try {
        updateStoryQuality(batch, storyId, evaluation.scores);
      } catch {
        continue; // story not found in batch, skip
      }

      if (evaluation.verdict === "certified") {
        updateStoryCertified(batch, storyId, evaluation.certified_hu);
      } else if (evaluation.verdict === "needs_context" && evaluation.context_needed) {
        addContextRequest(batch, storyId, {
          fields_needed: evaluation.context_needed.fields_needed || [],
          question: evaluation.context_needed.question_to_fde || ""
        });
      } else if (evaluation.verdict === "needs_rewrite" && evaluation.rewritten) {
        // Accept the rewrite and re-certify
        updateStoryCertified(batch, storyId, evaluation.rewritten);
      } else {
        updateStoryStatus(batch, storyId, "pending");
      }
    }

    await saveHuBatch(batchSessionId, batch);

    // --- Check if any need context ---
    const needsContext = batch.stories.filter(s => s.status === "needs_context");
    if (needsContext.length > 0) {
      const consolidatedQuestions = reviewOutput.result.batch_summary?.consolidated_questions
        || needsContext.map(s => {
          const pending = s.context_requests.find(r => !r.answered_at);
          return pending ? `[${s.id}] ${pending.question_to_fde}` : null;
        }).filter(Boolean).join("\n");

      if (!askQuestion) {
        // No interactive input — pause session
        break;
      }

      emitProgress(emitter, makeEvent("hu-reviewer:needs-context", { ...eventBase, stage: "hu-reviewer" }, {
        message: `${needsContext.length} story(ies) need context from FDE`,
        detail: { questions: consolidatedQuestions }
      }));

      const answer = await askQuestion(
        `The HU Reviewer needs additional context:\n\n${consolidatedQuestions}\n\nPlease provide your answers:`,
        { iteration: 0, stage: "hu-reviewer" }
      );

      if (!answer) break;

      // --- Incorporate FDE answers and re-evaluate ---
      for (const s of needsContext) {
        answerContextRequest(batch, s.id, answer);
      }
      await saveHuBatch(batchSessionId, batch);
      // Loop will re-evaluate entire batch
    }
  }

  await addCheckpoint(session, {
    stage: "hu-reviewer",
    iteration: 0,
    ok: true,
    certified: batch.stories.filter(s => s.status === "certified").length,
    total: batch.stories.length
  });

  // --- Return certified stories in topological order ---
  const certifiedStories = batch.stories.filter(s => s.status === "certified");
  let orderedIds;
  try {
    orderedIds = topologicalSort(certifiedStories);
  } catch { /* cyclic dependency */
    orderedIds = certifiedStories.map(s => s.id);
  }

  const orderedStories = orderedIds.map(id => batch.stories.find(s => s.id === id)).filter(Boolean);

  const stageResult = {
    ok: true,
    certified: certifiedStories.length,
    total: batch.stories.length,
    needsContext: batch.stories.filter(s => s.status === "needs_context").length,
    stories: orderedStories,
    batchSessionId
  };

  emitProgress(
    emitter,
    makeEvent("hu-reviewer:end", { ...eventBase, stage: "hu-reviewer" }, {
      status: "ok",
      message: `HU Review complete: ${certifiedStories.length}/${batch.stories.length} certified`,
      detail: { ...stageResult, provider: huReviewerProvider, executorType: "agent" }
    })
  );

  return { stageResult };
}
