/**
 * HU Sub-Pipeline — executes each certified HU as an independent sub-pipeline
 * with per-HU state tracking, topological ordering, and dependency-aware blocking.
 */
import { topologicalSort } from "../hu/graph.js";
import { updateStoryStatus, loadHuBatch, saveHuBatch, HU_STATUS } from "../hu/store.js";
import { emitProgress, makeEvent } from "../utils/events.js";

/**
 * Determine whether the HU reviewer result requires a sub-pipeline
 * (more than one certified story).
 * @param {object|null} huReviewerResult - stageResults.huReviewer
 * @returns {boolean}
 */
export function needsSubPipeline(huReviewerResult) {
  if (!huReviewerResult?.ok) return false;
  const certified = (huReviewerResult.stories || []).filter(
    s => s.status === "certified"
  );
  return certified.length > 1;
}

/**
 * Mark all stories that depend (directly or transitively) on a failed story as "blocked".
 * @param {object} batch - The HU batch object.
 * @param {string} failedId - The ID of the failed story.
 * @returns {string[]} IDs of newly blocked stories.
 */
export function blockDependents(batch, failedId) {
  const blocked = [];
  const failedSet = new Set([failedId]);
  // Iterate until no new blocked stories are found (handles transitive deps)
  let changed = true;
  while (changed) {
    changed = false;
    for (const story of batch.stories) {
      if (failedSet.has(story.id)) continue;
      if (story.status === HU_STATUS.BLOCKED) continue;
      const deps = story.blocked_by || [];
      if (deps.some(dep => failedSet.has(dep))) {
        updateStoryStatus(batch, story.id, HU_STATUS.BLOCKED);
        failedSet.add(story.id);
        blocked.push(story.id);
        changed = true;
      }
    }
  }
  return blocked;
}

/**
 * Build task description for the coder from a certified HU story.
 * @param {object} story - A story object from the batch.
 * @returns {string}
 */
function buildHuTask(story) {
  if (story.certified?.text) return story.certified.text;
  if (story.original?.text) return story.original.text;
  return `Implement HU ${story.id}`;
}

/**
 * Run all certified HUs as sub-pipelines in topological order.
 *
 * @param {object} params
 * @param {object} params.huReviewerResult - stageResults.huReviewer (from pre-loop)
 * @param {Function} params.runIterationFn - async (task) => { approved, result, ... }
 *   Callback that runs the full coder→sonar→reviewer iteration loop for a given task.
 *   Returns an object with at least { approved: boolean }.
 * @param {object} params.emitter - Event emitter
 * @param {object} params.eventBase - Base event fields
 * @param {object} params.logger - Logger instance
 * @returns {Promise<{approved: boolean, results: object[], blockedIds: string[]}>}
 */
export async function runHuSubPipeline({ huReviewerResult, runIterationFn, emitter, eventBase, logger }) {
  const batchSessionId = huReviewerResult.batchSessionId;
  let batch;
  try {
    batch = await loadHuBatch(batchSessionId);
  } catch {
    logger.warn("HU sub-pipeline: could not load batch, falling back to in-memory stories");
    // Build a minimal batch from the stage result
    batch = {
      session_id: batchSessionId,
      stories: huReviewerResult.stories || []
    };
  }

  const certifiedStories = batch.stories.filter(s => s.status === HU_STATUS.CERTIFIED);
  let orderedIds;
  try {
    orderedIds = topologicalSort(certifiedStories);
  } catch {
    orderedIds = certifiedStories.map(s => s.id);
  }

  const results = [];
  const blockedIds = [];
  let allApproved = true;

  for (const storyId of orderedIds) {
    const story = batch.stories.find(s => s.id === storyId);
    if (!story) continue;

    // Skip if already blocked by a failed dependency
    if (story.status === HU_STATUS.BLOCKED) {
      blockedIds.push(story.id);
      continue;
    }

    const huTask = buildHuTask(story);

    // --- hu:start ---
    emitProgress(emitter, makeEvent("hu:start", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `Starting HU ${story.id}`,
      detail: { huId: story.id, title: story.certified?.title || story.id }
    }));

    // Update status to coding
    updateStoryStatus(batch, story.id, HU_STATUS.CODING);
    await saveHuBatch(batchSessionId, batch);

    try {
      const iterResult = await runIterationFn(huTask);
      const approved = Boolean(iterResult?.approved);

      if (approved) {
        updateStoryStatus(batch, story.id, HU_STATUS.DONE);
        emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
          status: "ok",
          message: `HU ${story.id} completed successfully`,
          detail: { huId: story.id, approved: true }
        }));
        results.push({ huId: story.id, approved: true, result: iterResult });
      } else {
        updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
        const newlyBlocked = blockDependents(batch, story.id);
        blockedIds.push(...newlyBlocked);
        allApproved = false;

        emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
          status: "fail",
          message: `HU ${story.id} failed — ${newlyBlocked.length} dependent(s) blocked`,
          detail: { huId: story.id, approved: false, blockedDependents: newlyBlocked, reason: iterResult?.reason }
        }));
        results.push({ huId: story.id, approved: false, result: iterResult, blockedDependents: newlyBlocked });
      }
    } catch (err) {
      updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
      const newlyBlocked = blockDependents(batch, story.id);
      blockedIds.push(...newlyBlocked);
      allApproved = false;

      emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        status: "fail",
        message: `HU ${story.id} threw: ${err.message}`,
        detail: { huId: story.id, approved: false, error: err.message, blockedDependents: newlyBlocked }
      }));
      results.push({ huId: story.id, approved: false, error: err.message, blockedDependents: newlyBlocked });
    }

    await saveHuBatch(batchSessionId, batch);
  }

  return { approved: allApproved, results, blockedIds };
}
