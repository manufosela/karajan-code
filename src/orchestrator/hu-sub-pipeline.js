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
 * Determine whether the HU reviewer result needs the sub-pipeline path.
 *
 * Pre-fix this returned true only when there were > 1 certified stories.
 * That broke single-HU runs (`kj run --plan <id> --hu <huId>`, the path
 * the board's per-card ▶ button drives): with exactly one HU certified
 * the flow fell through to the standard single-task pipeline, which
 * does NOT call updateStoryStatus / saveHuBatch / emit hu:* events.
 * Result: the HU stayed forever in `coding` even after the run finished
 * because nobody persisted "done"/"failed" anywhere — board kanban
 * showed "1 running…" indefinitely, plan JSON kept the stale status.
 *
 * The sub-pipeline already handles a 1-HU batch as a degenerate case
 * (no dependency graph to resolve, no parallel batching) — so the fix
 * is to take that path for any non-empty batch, not just >1.
 *
 * @param {object|null} huReviewerResult - stageResults.huReviewer
 * @returns {boolean}
 */
export function needsSubPipeline(huReviewerResult) {
  if (!huReviewerResult?.ok) return false;
  const certified = (huReviewerResult.stories || []).filter(
    s => s.status === "certified"
  );
  return certified.length >= 1;
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
 * Sum the cost_usd of a slice of BudgetTracker entries. Returns null
 * (not 0) when the slice is empty or contains no usable cost data —
 * the board uses null as "unmeasured" and renders no badge, while 0
 * means "really free run". Mixing the two would silently hide free
 * runs and falsely show "$0.00" for runs with no telemetry.
 *
 * Cost D (KJC-TSK-0515): the orchestrator calls this once per HU at
 * runSingleHu exit, passing the slice of entries recorded during that
 * HU (snapshotted via the entries.length cursor before the iteration
 * starts). The resulting number flows through buildHuOutcome →
 * notifyOutcome → setStoryCost in inject-loaded-plan.js.
 *
 * @param {Array<{cost_usd?: number}>} entries
 * @returns {number|null}
 */
function sumCostUsd(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let total = 0;
  let hasAny = false;
  for (const e of entries) {
    const n = Number(e?.cost_usd);
    if (Number.isFinite(n)) {
      total += n;
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  return Math.round(total * 1e6) / 1e6;
}

/**
 * Build the per-HU outcome blob from whatever metadata the iteration
 * loop returned. Tolerant by design — most fields are optional and we
 * default to safe values so the board can render something useful
 * even on weird failure modes (HU crashed before producing summary,
 * runIterationFn missing the commits array, etc.).
 *
 * Plain-Spanish summary lives at the bottom of the priority order so
 * we surface what the run actually said before falling back to
 * generic phrases.
 *
 * @param {object} args
 * @param {object} args.story
 * @param {object} args.iterResult — whatever runIterationFn returned
 * @param {string} args.status — HU_STATUS.* terminal value
 * @param {number} args.startedAt — Date.now() when runSingleHu started
 * @param {Array} [args.huBudgetEntries] — slice of BudgetTracker
 *   entries recorded during this HU. Cost D (KJC-TSK-0515).
 * @returns {object}
 */
function buildHuOutcome({ story: _story, iterResult, status, startedAt, huBudgetEntries }) {
  const r = iterResult || {};
  const git = r.git || {};
  // Iterations are tracked in the standard pipeline as
  // `result.iterations`, in the tests-first pipeline as the loop
  // counter — fall back to whatever we can find.
  const iterations = r.iterations ?? r.iteration ?? r.attempts ?? null;
  const commits = Array.isArray(git.commits)
    ? git.commits.map((c) => (typeof c === "string" ? c : c.hash || c.sha || "")).filter(Boolean)
    : (Array.isArray(r.commits) ? r.commits : []);
  const blockers = [];
  if (r.error) blockers.push(String(r.error));
  if (r.reason && r.reason !== "approved") blockers.push(String(r.reason));
  if (Array.isArray(r.deferredIssues)) {
    for (const d of r.deferredIssues) blockers.push(typeof d === "string" ? d : d.message || JSON.stringify(d));
  }
  // Plain-Spanish, one-or-two sentences.
  let summary;
  if (r.review?.summary) summary = String(r.review.summary);
  else if (status === "done") summary = `HU completada${commits.length ? ` con ${commits.length} commit(s)` : ""}.`;
  else if (status === "failed") summary = `HU falló${blockers.length ? `: ${blockers[0]}` : ""}.`;
  else summary = `HU ${status}.`;
  return {
    status,
    iterations: typeof iterations === "number" ? iterations : null,
    duration_ms: typeof startedAt === "number" ? Date.now() - startedAt : null,
    branch: r.branch || git.branch || null,
    commits,
    pr_url: r.pr_url || r.prUrl || git.pr_url || null,
    blockers,
    summary,
    cost_usd: sumCostUsd(huBudgetEntries),
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Execute a single HU through the coder→sonar→reviewer sub-pipeline.
 * Extracted to support both sequential and parallel execution paths.
 *
 * @param {object} params
 * @returns {Promise<{huId: string, approved: boolean, result?: object, error?: string, blockedDependents?: string[]}>}
 */
async function runSingleHu({ storyId, batch, batchSessionId, runIterationFn, emitter, eventBase, logger, config, results, worktreePath, onStatusChange = null, onOutcome = null, budgetTracker = null }) {
  // PR1 (live HU status): every saveHuBatch should also notify the
  // plan JSON so the board reflects state in real time. Defined as a
  // local helper so we don't repeat the try/null-check boilerplate.
  const notifyStatus = async (huId, status) => {
    if (typeof onStatusChange !== "function") return;
    try { await onStatusChange(huId, status); }
    catch (err) { logger?.warn?.(`onStatusChange(${huId}, ${status}) failed: ${err.message}`); }
  };
  // PR3 (per-HU outcome): single notification at the end of the HU
  // with the rich outcome blob. Plan JSON gets it stamped before
  // we return, so the board's chokidar fires once and the card
  // shows its summary indicator.
  const notifyOutcome = async (huId, outcome) => {
    if (typeof onOutcome !== "function") return;
    try { await onOutcome(huId, outcome); }
    catch (err) { logger?.warn?.(`onOutcome(${huId}) failed: ${err.message}`); }
  };

  // PR3: capture the start time so duration can be reported in the
  // outcome (wall-clock per HU is what the user needs in the board,
  // not internal stage timings).
  const huStartedAt = Date.now();
  // Cost D (KJC-TSK-0515): snapshot the budget cursor so we can slice
  // out only the entries this HU produced. BudgetTracker is session-
  // scoped (it accumulates across all HUs of the run), so without this
  // cursor every HU after the first would inherit the previous ones'
  // cost too. Null-safe — older callers without a tracker still work.
  const huBudgetStartIdx = budgetTracker?.entries?.length ?? 0;
  const sliceHuBudget = () => {
    if (!budgetTracker?.entries) return [];
    return budgetTracker.entries.slice(huBudgetStartIdx);
  };
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
  await notifyStatus(story.id, HU_STATUS.CODING);
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
    await notifyStatus(story.id, HU_STATUS.REVIEWING);
    emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
      message: `HU ${story.id} status → reviewing`,
      detail: { huId: story.id, status: HU_STATUS.REVIEWING, timestamp: new Date().toISOString() }
    }));

    if (approved) {
      updateStoryStatus(batch, story.id, HU_STATUS.DONE);
      await saveHuBatch(batchSessionId, batch);
      await notifyStatus(story.id, HU_STATUS.DONE);
      // PR3: build + persist the per-HU outcome.
      const okOutcome = buildHuOutcome({ story, iterResult, status: HU_STATUS.DONE, startedAt: huStartedAt, huBudgetEntries: sliceHuBudget() });
      await notifyOutcome(story.id, okOutcome);
      emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
        message: `HU ${story.id} status → done`,
        detail: { huId: story.id, status: HU_STATUS.DONE, timestamp: new Date().toISOString() }
      }));
      emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        status: "ok",
        message: `HU ${story.id} completed successfully`,
        detail: { huId: story.id, approved: true, outcome: okOutcome }
      }));
      return { huId: story.id, approved: true, result: iterResult };
    } else {
      updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
      await saveHuBatch(batchSessionId, batch);
      await notifyStatus(story.id, HU_STATUS.FAILED);
      const failOutcome = buildHuOutcome({ story, iterResult, status: HU_STATUS.FAILED, startedAt: huStartedAt, huBudgetEntries: sliceHuBudget() });
      await notifyOutcome(story.id, failOutcome);
      emitProgress(emitter, makeEvent("hu:status-change", { ...eventBase, stage: "hu-sub-pipeline" }, {
        message: `HU ${story.id} status → failed`,
        detail: { huId: story.id, status: HU_STATUS.FAILED, timestamp: new Date().toISOString() }
      }));
      emitProgress(emitter, makeEvent("hu:end", { ...eventBase, stage: "hu-sub-pipeline" }, {
        status: "fail",
        message: `HU ${story.id} failed`,
        detail: { huId: story.id, approved: false, reason: iterResult?.reason, outcome: failOutcome }
      }));
      return { huId: story.id, approved: false, result: iterResult };
    }
  } catch (err) {
    updateStoryStatus(batch, story.id, HU_STATUS.FAILED);
    await saveHuBatch(batchSessionId, batch);
    await notifyStatus(story.id, HU_STATUS.FAILED);
    const errOutcome = buildHuOutcome({ story, iterResult: { error: err.message }, status: HU_STATUS.FAILED, startedAt: huStartedAt, huBudgetEntries: sliceHuBudget() });
    await notifyOutcome(story.id, errOutcome);
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
export async function runHuSubPipeline({ huReviewerResult, runIterationFn, emitter, eventBase, logger, config = null, onStatusChange = null, onOutcome = null, budgetTracker = null }) {
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

  // Plan-driven runs: the plan JSON is the source of truth for the
  // ENTIRE HU, NOT just status, NOT the on-disk hu-stories batch.
  //
  // PR #537 reconciled `status` and fixed the "All HUs completed
  // successfully for zero work" bug. But status is only ONE field of
  // the HU. The 2026-04-29 incident hit a different field — a user
  // edited the plan JSON to fix a broken jq query inside the HU's
  // `acceptance_tests`, but the persisted batch kept the broken
  // version, so the acceptance runner used the broken test, the coder
  // burned every iteration trying to make an irreparable test pass,
  // and the HU failed.
  //
  // Treat the plan as authoritative for ALL content fields the user
  // might edit between runs (acceptance_tests, title, scope,
  // blocked_by, spec_section, original.text). In-flight runtime
  // context that doesn't live in the plan (worktree path, refinement
  // state, certification quality scores, context_requests) is
  // preserved.
  if (huReviewerResult.source?.plan === true && Array.isArray(huReviewerResult.stories)) {
    // Fields the plan owns. Anything NOT in this set is preserved
    // from the persisted batch (in-flight runtime state).
    const PLAN_OWNED_FIELDS = [
      "status",
      "title",
      "scope",
      "blocked_by",
      "acceptance_tests",
      "acceptance_criteria",
      "spec_section",
      "task_type",
      "certified",   // canonical HU body
      "original",    // original text reference
    ];
    const planById = new Map(huReviewerResult.stories.map((s) => [s.id, s]));
    let statusChanges = 0;
    let contentChanges = 0;
    for (const persisted of batch.stories) {
      const fromPlan = planById.get(persisted.id);
      if (!fromPlan) continue;
      for (const field of PLAN_OWNED_FIELDS) {
        if (!(field in fromPlan)) continue;
        const before = JSON.stringify(persisted[field]);
        const after = JSON.stringify(fromPlan[field]);
        if (before === after) continue;
        persisted[field] = fromPlan[field];
        if (field === "status") statusChanges += 1;
        else contentChanges += 1;
      }
    }
    // Stories present in the plan but missing from disk → append.
    const persistedIds = new Set(batch.stories.map((s) => s.id));
    let appended = 0;
    for (const fromPlan of huReviewerResult.stories) {
      if (!persistedIds.has(fromPlan.id)) {
        batch.stories.push(fromPlan);
        appended += 1;
      }
    }
    const totalChanges = statusChanges + contentChanges + appended;
    if (totalChanges > 0) {
      const parts = [];
      if (statusChanges > 0) parts.push(`${statusChanges} status`);
      if (contentChanges > 0) parts.push(`${contentChanges} content field(s)`);
      if (appended > 0) parts.push(`${appended} appended`);
      logger.info(`HU sub-pipeline: reconciled from plan — ${parts.join(", ")} (disk batch was stale)`);
      await saveHuBatch(batchSessionId, batch);
    }
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
        emitter, eventBase, logger, config, results, onStatusChange, onOutcome, budgetTracker
      });
      results.push(singleResult);
      if (!singleResult.approved) {
        allApproved = false;
        const newlyBlocked = blockDependents(batch, singleResult.huId);
        blockedIds.push(...newlyBlocked);
        // PR1 (live HU status): notify the plan JSON of every newly
        // BLOCKED HU so the board moves them into the blocked column
        // without waiting for the run to finish.
        if (typeof onStatusChange === "function") {
          for (const blockedHuId of newlyBlocked) {
            try { await onStatusChange(blockedHuId, HU_STATUS.BLOCKED); }
            catch (err) { logger?.warn?.(`onStatusChange(${blockedHuId}, blocked) failed: ${err.message}`); }
          }
        }
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
          worktreePath: worktrees.get(storyId),
          onStatusChange, onOutcome, budgetTracker
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
          // PR1 (live HU status): same as the single-HU path — push
          // BLOCKED transitions to the plan JSON immediately so the
          // board shows them moving to the blocked column live.
          if (typeof onStatusChange === "function") {
            for (const blockedHuId of newlyBlocked) {
              try { await onStatusChange(blockedHuId, HU_STATUS.BLOCKED); }
              catch (err) { logger?.warn?.(`onStatusChange(${blockedHuId}, blocked) failed: ${err.message}`); }
            }
          }
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
