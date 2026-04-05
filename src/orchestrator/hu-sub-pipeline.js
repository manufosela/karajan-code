/**
 * HU Sub-Pipeline — executes each certified HU as an independent sub-pipeline
 * with per-HU state tracking, topological ordering, and dependency-aware blocking.
 */
import { topologicalSort } from "../hu/graph.js";
import { updateStoryStatus, loadHuBatch, saveHuBatch, HU_STATUS } from "../hu/store.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { refineHuWithContext } from "../hu/lazy-planner.js";
import { findParallelGroups, createWorktree, mergeWorktree, removeWorktree } from "../hu/parallel-executor.js";

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
 * Execute a single HU through the coder→sonar→reviewer sub-pipeline.
 * Extracted to support both sequential and parallel execution paths.
 *
 * @param {object} params
 * @returns {Promise<{huId: string, approved: boolean, result?: object, error?: string, blockedDependents?: string[]}>}
 */
async function runSingleHu({ storyId, batch, batchSessionId, runIterationFn, emitter, eventBase, logger, config, results, worktreePath }) {
  const story = batch.stories.find(s => s.id === storyId);

  // --- Lazy refinement ---
  if (story.needsRefinement && config) {
    const completedHus = results
      .filter(r => r.approved)
      .map(r => {
        const completedStory = batch.stories.find(s => s.id === r.huId);
        return {
          ...completedStory,
          resultSummary: r.result?.summary || r.result?.reason || null
        };
      });

    emitProgress(emitter, makeEvent("hu:refine-start", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `Refining HU ${story.id} with context from ${completedHus.length} completed HU(s)`,
      detail: { huId: story.id, completedCount: completedHus.length }
    }));

    try {
      const refined = await refineHuWithContext(story, completedHus, config, logger);
      Object.assign(story, refined);
      story.needsRefinement = false;
      await saveHuBatch(batchSessionId, batch);

      emitProgress(emitter, makeEvent("hu:refine-end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        message: `HU ${story.id} refined successfully`,
        detail: { huId: story.id }
      }));
    } catch (err) {
      logger.warn(`Lazy refinement failed for HU ${story.id}: ${err.message} — proceeding with original`);
      story.needsRefinement = false;
    }
  }

  const huTask = buildHuTask(story);

  // --- hu:start ---
  emitProgress(emitter, makeEvent("hu:start", { ...eventBase, stage: "hu-sub-pipeline" }, {
    message: `Starting HU ${story.id}`,
    detail: { huId: story.id, title: story.certified?.title || story.id, worktreePath: worktreePath || null }
  }));

  updateStoryStatus(batch, story.id, HU_STATUS.CODING);
  await saveHuBatch(batchSessionId, batch);
  emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
    message: `HU ${story.id} status → coding`,
    detail: { huId: story.id, status: HU_STATUS.CODING, timestamp: new Date().toISOString() }
  }));

  try {
    const iterResult = await runIterationFn(huTask, story);
    const approved = Boolean(iterResult?.approved);

    // --- Transition to reviewing (post-coder, pre-reviewer evaluation) ---
    updateStoryStatus(batch, story.id, HU_STATUS.REVIEWING);
    await saveHuBatch(batchSessionId, batch);
    emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `HU ${story.id} status → reviewing`,
      detail: { huId: story.id, status: HU_STATUS.REVIEWING, timestamp: new Date().toISOString() }
    }));

    if (approved) {
      updateStoryStatus(batch, story.id, HU_STATUS.DONE);
      await saveHuBatch(batchSessionId, batch);
      emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
        message: `HU ${story.id} status → done`,
        detail: { huId: story.id, status: HU_STATUS.DONE, timestamp: new Date().toISOString() }
      }));
      emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        status: "ok",
        message: `HU ${story.id} completed successfully`,
        detail: { huId: story.id, approved: true }
      }));
      return { huId: story.id, approved: true, result: iterResult };
    } else {
      updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
      await saveHuBatch(batchSessionId, batch);
      emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
        message: `HU ${story.id} status → failed`,
        detail: { huId: story.id, status: HU_STATUS.FAILED, timestamp: new Date().toISOString() }
      }));
      emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        status: "fail",
        message: `HU ${story.id} failed`,
        detail: { huId: story.id, approved: false, reason: iterResult?.reason }
      }));
      return { huId: story.id, approved: false, result: iterResult };
    }
  } catch (err) {
    updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
    await saveHuBatch(batchSessionId, batch);
    emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `HU ${story.id} status → failed`,
      detail: { huId: story.id, status: HU_STATUS.FAILED, timestamp: new Date().toISOString() }
    }));
    emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
      status: "fail",
      message: `HU ${story.id} threw: ${err.message}`,
      detail: { huId: story.id, approved: false, error: err.message }
    }));
    return { huId: story.id, approved: false, error: err.message };
  }
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
export async function runHuSubPipeline({ huReviewerResult, runIterationFn, emitter, eventBase, logger, config = null }) {
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
  } catch { /* cyclic dependency */
    orderedIds = certifiedStories.map(s => s.id);
  }

  const results = [];
  const blockedIds = [];
  let allApproved = true;

  // --- Group HUs into parallel batches ---
  const parallelBatches = findParallelGroups(certifiedStories, orderedIds);

  for (const group of parallelBatches) {
    // Filter out HUs that were blocked by a failed dependency in a previous batch
    const runnableIds = group.filter(id => {
      const story = batch.stories.find(s => s.id === id);
      return story && story.status !== HU_STATUS.BLOCKED;
    });

    if (runnableIds.length === 0) continue;

    // Emit parallel batch start event
    emitProgress(emitter, makeEvent("hu:parallel-start", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `Starting parallel batch of ${runnableIds.length} HU(s): ${runnableIds.join(", ")}`,
      detail: { batchIds: runnableIds, parallel: runnableIds.length > 1 }
    }));

    if (runnableIds.length === 1) {
      // Single HU: run as before, no worktree needed
      const singleResult = await runSingleHu({
        storyId: runnableIds[0], batch, batchSessionId, runIterationFn,
        emitter, eventBase, logger, config, results
      });
      results.push(singleResult);
      if (!singleResult.approved) {
        allApproved = false;
        const newlyBlocked = blockDependents(batch, singleResult.huId);
        blockedIds.push(...newlyBlocked);
      }
      await saveHuBatch(batchSessionId, batch);
    } else {
      // Multiple HUs: create worktrees, run in parallel
      const projectDir = config?.projectDir || process.cwd();
      const worktrees = new Map();

      // Create worktrees for each HU in the batch
      for (const id of runnableIds) {
        try {
          const wtPath = await createWorktree(projectDir, id);
          worktrees.set(id, wtPath);
        } catch (err) {
          logger.warn(`Failed to create worktree for HU ${id}: ${err.message} — will run sequentially`);
        }
      }

      // Run all HUs in the batch concurrently
      const batchPromises = runnableIds.map(async (storyId) => {
        return runSingleHu({
          storyId, batch, batchSessionId, runIterationFn,
          emitter, eventBase, logger, config, results,
          worktreePath: worktrees.get(storyId)
        });
      });

      const batchResults = await Promise.all(batchPromises);

      // Process results: merge successful worktrees sequentially, clean up failed ones
      for (const res of batchResults) {
        results.push(res);
        if (res.approved && worktrees.has(res.huId)) {
          try {
            await mergeWorktree(projectDir, res.huId);
          } catch (err) {
            logger.warn(`Failed to merge worktree for HU ${res.huId}: ${err.message}`);
          }
        } else if (!res.approved) {
          allApproved = false;
          const newlyBlocked = blockDependents(batch, res.huId);
          blockedIds.push(...newlyBlocked);
          // Clean up failed worktree
          if (worktrees.has(res.huId)) {
            try { await removeWorktree(projectDir, res.huId); } catch { /* ignore */ }
          }
        }
      }

      await saveHuBatch(batchSessionId, batch);
    }
  }

  return { approved: allApproved, results, blockedIds };
}
