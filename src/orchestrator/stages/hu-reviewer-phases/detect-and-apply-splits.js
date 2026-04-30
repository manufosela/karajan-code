/**
 * HU Reviewer phase: detect splittable HUs and apply the split.
 *
 * Extracted from `runHuReviewerStage` in PR-M (audit follow-up,
 * KJC-PCS-0033). Was 78 LOC inlined inside the 311-LOC parent
 * function — moving it brings the stage closer to a clean
 * load → split → evaluate → return shape.
 *
 * For each pending HU in the batch:
 *
 *   1. Run the deterministic indicator detector
 *      (src/hu/splitting-detector.js). If no indicators, skip.
 *   2. Pick the first heuristic that matches; ask the LLM for a
 *      split proposal. Retry with other heuristics on failure.
 *   3. In autonomous mode (askQuestion=null) the proposal is
 *      auto-accepted. In interactive mode the FDE confirms.
 *   4. Replace the original story with the proposed sub-HUs in
 *      the batch and persist.
 *
 * Behaviour identical to the inlined version — only the container
 * changes. The closure variables (batch, askQuestion, config,
 * logger, emitter, eventBase, batchSessionId) become explicit
 * function parameters.
 */

import { saveHuBatch, updateStoryStatus } from "#hu/store.js";
import { emitProgress, makeEvent } from "#utils/events.js";
import { detectIndicators, selectHeuristic } from "#hu/splitting-detector.js";
import { generateSplitProposal, formatSplitProposalForFDE, buildSplitDependencies } from "#hu/splitting-generator.js";

/**
 * Build a fresh sub-HU story object from a proposal entry. Same
 * shape the inlined code produced; centralised to avoid the
 * autonomous + interactive paths drifting apart.
 */
function buildSubHuStory(sub) {
  const text = `${sub.title}\n\n${sub.text}\n\nAcceptance Criteria:\n${(sub.acceptanceCriteria || []).map((ac) => `- ${ac}`).join("\n")}`;
  const now = new Date().toISOString();
  return {
    id: sub.id,
    status: "pending",
    original: { text },
    blocked_by: sub.blocked_by || [],
    certified: null,
    quality: null,
    context_requests: [],
    created_at: now,
    updated_at: now,
  };
}

/**
 * Replace `story` in `batch.stories` with the expanded sub-HUs and
 * emit the `hu-reviewer:split-accepted` event.
 */
function applySplit({ batch, story, proposal, heuristic, source, eventBase, emitter }) {
  const updatedSubHUs = buildSplitDependencies(proposal.subHUs, story);
  const storyIndex = batch.stories.findIndex((s) => s.id === story.id);
  const newStories = updatedSubHUs.map(buildSubHuStory);
  batch.stories.splice(storyIndex, 1, ...newStories);
  emitProgress(emitter, makeEvent("hu-reviewer:split-accepted", { ...eventBase, stage: "hu-reviewer" }, {
    message: `${source} accepted split of ${story.id} into ${updatedSubHUs.length} sub-HUs`,
    detail: { originalId: story.id, subHUs: updatedSubHUs.map((s) => s.id), heuristic }
  }));
}

/**
 * @param {object} args
 * @param {object} args.batch              — HU batch (mutated in place)
 * @param {string} args.batchSessionId     — for saveHuBatch persistence
 * @param {Function|null} args.askQuestion — interactive prompt (null = auto-accept)
 * @param {object} args.config
 * @param {object} args.logger
 * @param {object} args.emitter
 * @param {object} args.eventBase
 */
export async function detectAndApplySplits({ batch, batchSessionId, askQuestion, config, logger, emitter, eventBase }) {
  const storiesToSplit = [...batch.stories].filter((s) => s.status === "pending");
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
        // Autonomous mode: auto-accept the split.
        applySplit({ batch, story, proposal, heuristic, source: "Auto", eventBase, emitter });
        splitAccepted = true;
      } else {
        // Interactive mode: ask FDE for confirmation.
        const formatted = formatSplitProposalForFDE(proposal);
        const question = `Split proposed for ${story.id}:\n${formatted}\nAccept? (yes/no/try another)`;
        emitProgress(emitter, makeEvent("hu-reviewer:split-proposal", { ...eventBase, stage: "hu-reviewer" }, {
          message: `Split proposal for ${story.id} using heuristic: ${heuristic}`,
          detail: { originalId: story.id, heuristic, subHUCount: proposal.subHUs.length }
        }));
        const answer = await askQuestion(question, { iteration: 0, stage: "hu-reviewer" });
        if (!answer || answer.toLowerCase().startsWith("yes")) {
          applySplit({ batch, story, proposal, heuristic, source: "FDE", eventBase, emitter });
          splitAccepted = true;
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
}
