/**
 * Pre-loop phase: load a persisted plan and inject it into stageResults.
 *
 * Extracted from `src/orchestrator/drivers/pre-loop.js` in PR-K (audit
 * follow-up) to drag runPreLoopStages out of god-function territory
 * (was 496 LOC; extracting this 189-LOC block brings it to ~310).
 *
 * Behaviour is byte-for-byte identical to the inlined version. The
 * extraction keeps the dynamic-import pattern (deferred load of
 * plan-store / plan-schema / plan-executor / plan-hu-ops) so the
 * dynamic-imports budget test stays unchanged.
 *
 * Returns { handled, plannedTask }:
 *   - handled=true  → caller short-circuits (plan was loaded; skip
 *                     researcher/architect/planner phases below).
 *   - handled=false → caller continues with the regular planning flow.
 *     Either flags.plan was unset OR loadPlan returned null OR the
 *     try/catch swallowed an error (logged as a warning).
 *
 * The function still mutates session via the existing mutators
 * (setPlanRef, setPlanSyncCallback, setLiveStatusUpdater,
 * setLiveOutcomeUpdater, setPreLoopContext) and stageResults
 * (researcher / architect / planner / huReviewer slots). That
 * mutation contract is unchanged from the inlined version — see
 * tests/architecture/session-write-boundary.test.js for the
 * mutator-routing invariant.
 */

import { saveSession } from "#session/store.js";
import {
  setPlanRef, setPlanSyncCallback, setLiveStatusUpdater,
  setLiveOutcomeUpdater, setPreLoopContext,
} from "#session/mutators.js";
import { emitProgress, makeEvent } from "#utils/events.js";

/**
 * @param {object} args
 * @param {object} args.flags        — runFlow flags (reads flags.plan, flags.hu)
 * @param {object} args.updatedConfig — the running config (reads projectDir)
 * @param {object} args.session
 * @param {object} args.stageResults — mutated: researcher / architect / planner / huReviewer slots
 * @param {object} args.eventBase
 * @param {object} args.emitter
 * @param {object} args.logger
 * @param {string} args.task         — original task description, used to build plannedTask
 * @returns {Promise<{handled: boolean, plannedTask: string|null}>}
 */
export async function injectLoadedPlan({ flags, updatedConfig, session, stageResults, eventBase, emitter, logger, task }) {
  if (!flags.plan) return { handled: false, plannedTask: null };

  try {
    const { loadPlan, savePlan: savePlanToDisk } = await import("../../../plan/plan-store.js");
    const { isPlanV2 } = await import("../../../plan/plan-schema.js");
    const { planToHuBatch, syncResultsToPlan } = await import("../../../plan/plan-executor.js");
    const projectDir = updatedConfig.projectDir || process.cwd();
    const loadedPlan = await loadPlan(projectDir, flags.plan);
    if (!loadedPlan) {
      logger.warn(`Plan ${flags.plan} not found — falling back to normal pipeline`);
      return { handled: false, plannedTask: null };
    }

    logger.info(`Loaded persisted plan: ${flags.plan} (v${loadedPlan.version || 1})`);
    emitProgress(emitter, makeEvent("plan:loaded", { ...eventBase, stage: "plan" }, {
      message: `Plan loaded: ${flags.plan}`,
      detail: { planId: flags.plan, task: loadedPlan.task, version: loadedPlan.version, huCount: loadedPlan.hus?.length || 0 }
    }));

    // Zombie reconciliation: a previous run may have died mid-flight,
    // leaving HUs stuck in coding/reviewing/running. The board-side
    // reaper only runs inside the board; without this, a headless
    // `kj run --plan` would refuse to pick those HUs up.
    const reaped = await reconcilePlanHuZombies({ loadedPlan, planId: flags.plan, logger });
    if (reaped > 0) {
      await savePlanToDisk(projectDir, loadedPlan);
      emitProgress(emitter, makeEvent("plan:zombies-reaped", { ...eventBase, stage: "plan" }, {
        message: `Reset ${reaped} stale HU(s) from a previous run that did not finish`,
        detail: { planId: flags.plan, count: reaped }
      }));
    }
    stageResults.researcher = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
    stageResults.architect = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };
    stageResults.planner = { ok: true, summary: "Loaded from persisted plan", fromPlan: flags.plan };

    // Tests-first gate (v2.7.5): refuse to run a plan when any HU
    // has no acceptance_tests. Mirrors the gate in `kj plan ready`
    // so the CLI path and the board's "▶ Run plan" button enforce
    // the same contract.
    if (isPlanV2(loadedPlan) && Array.isArray(loadedPlan.hus)) {
      assertEveryHuHasTests({ loadedPlan, planId: flags.plan, eventBase, emitter, logger });

      // PR-E (auto-certify + anomaly guards): the user expects
      // pending HUs to be runnable; "certified" was an invisible
      // wall. Helpers in plan-hu-ops.js so they can be unit-tested
      // without spinning up the orchestrator. Pulled from the same
      // dynamic import we use a few lines below for updateHuStatus +
      // setHuOutcome — no extra import budget.
      const planHuOps = await import("../../../plan/plan-hu-ops.js");
      await autoCertifyAndAssertRunnable({ planHuOps, loadedPlan, planId: flags.plan, projectDir, savePlanToDisk, eventBase, emitter, logger });

      // v2 plan with HUs → inject as huReviewer so sub-pipeline
      // picks them up. Sets every callback (sync, live status, live
      // outcome) and stamps plan.status = "running".
      if (loadedPlan.hus?.length > 0) {
        const huBatch = planToHuBatch(loadedPlan);
        applyHuFilterIfRequested({ huBatch, flags, eventBase, emitter, logger });
        if (huBatch.ok) {
          stageResults.huReviewer = huBatch;
          wirePlanCallbacks({ session, loadedPlan, projectDir, syncResultsToPlan, savePlanToDisk, planHuOps, logger });
          logger.info(`Plan ${flags.plan}: ${huBatch.certified} HUs ready for execution`);
          emitProgress(emitter, makeEvent("plan:hus-loaded", { ...eventBase, stage: "plan" }, {
            message: `${huBatch.certified} HUs loaded from plan`,
            detail: { planId: flags.plan, total: huBatch.total, certified: huBatch.certified }
          }));
          loadedPlan.status = "running";
          await savePlanToDisk(projectDir, loadedPlan);
        }
      }
    }

    // Inject contexts that the legacy planning phases would have
    // produced. Then build a plannedTask string for the non-HU /
    // fallback iteration path.
    const ctx = loadedPlan.context || {};
    setPreLoopContext(session, {
      research: ctx.researchContext || loadedPlan.researchContext || null,
      architect: ctx.architectContext || loadedPlan.architectContext || null,
      plan: loadedPlan.approach || loadedPlan.plan || null,
    });
    await saveSession(session);

    return { handled: true, plannedTask: buildPlannedTaskFromLoadedPlan({ task, loadedPlan }) };
  } catch (err) {
    logger.warn(`Plan loading failed: ${err.message} — falling back to normal pipeline`);
    return { handled: false, plannedTask: null };
  }
}

/**
 * Reset HUs that look mid-execution but have no live run behind them.
 *
 * Resilience audit, Phase 3 (Hallazgo A1 / status-zombi). A previous
 * `kj run --plan` flipped HUs to `coding`/`reviewing`/`running` in the
 * plan JSON, then died (SIGKILL, terminal closed, OOM, crash). The
 * board-side `hu-zombie-reaper` only queries SQLite and only runs
 * inside the board process, so the plan JSON on disk kept stale
 * in-flight statuses forever. The next `kj run --plan` then refused to
 * pick those HUs up.
 *
 * Cross-check via `run-registry`: if there is a live run with our
 * planId, do NOT touch — that run owns the in-flight HUs. Otherwise
 * any in-flight status with no live owner is a zombie → reset to
 * `pending` so it can run again.
 *
 * Mutates `loadedPlan.hus` in place. Returns the number of HUs reset
 * so the caller can persist + emit a progress event.
 *
 * @param {object} args
 * @param {object} args.loadedPlan
 * @param {string} args.planId
 * @param {object} [args.logger]
 * @returns {Promise<number>}
 */
export async function reconcilePlanHuZombies({ loadedPlan, planId, logger }) {
  if (!Array.isArray(loadedPlan?.hus) || loadedPlan.hus.length === 0) return 0;
  const { listActiveRuns } = await import("../../../utils/run-registry.js");
  const activeRuns = listActiveRuns({ planId });
  if (activeRuns.length > 0) return 0;
  const ZOMBIE_STATES = new Set(["coding", "reviewing", "running"]);
  let reaped = 0;
  for (const hu of loadedPlan.hus) {
    if (ZOMBIE_STATES.has(hu.status)) {
      const previous = hu.status;
      hu.status = "pending";
      reaped += 1;
      logger?.warn?.(`[plan] HU ${hu.id || hu.hu_id || "?"} was '${previous}' but no live run owns the plan — reset to 'pending'.`);
    }
  }
  return reaped;
}

/**
 * Throws when any HU lacks an acceptance_tests array with at least
 * one entry. Logs + emits the same `plan:tests-missing` progress
 * event as the inlined version did.
 */
function assertEveryHuHasTests({ loadedPlan, planId, eventBase, emitter, logger }) {
  const missing = loadedPlan.hus.filter(
    (h) => !Array.isArray(h.acceptance_tests) || h.acceptance_tests.length === 0
  );
  if (missing.length === 0) return;
  const offenders = missing.map((h) => `  - ${h.id}  ${(h.title || "").slice(0, 60)}`).join("\n");
  const msg =
    `Refusing to run plan ${planId}: ${missing.length}/${loadedPlan.hus.length} HU(s) have no acceptance_tests.\n`
    + `${offenders}\n\n`
    + "Tests-first flow requires a test contract per HU. Edit each HU on the board\n"
    + "(http://localhost:4000) via the ✎ Edit button, or re-run `kj plan` to regenerate.";
  logger.error(msg);
  emitProgress(emitter, makeEvent("plan:tests-missing", { ...eventBase, stage: "plan" }, {
    status: "fail",
    message: `Plan ${planId}: ${missing.length} HU(s) missing acceptance_tests`,
    detail: { planId, missingHuIds: missing.map((h) => h.id) }
  }));
  throw new Error(`Plan ${planId} has ${missing.length} HU(s) with no acceptance_tests — see the run log for details.`);
}

/**
 * Promotes pending HUs with tests to certified, then asserts at
 * least one HU is runnable. Throws (with `plan:no-runnable` event)
 * when nothing is left to do, so the orchestrator never silently
 * falls back to single-task mode and burns tokens.
 */
async function autoCertifyAndAssertRunnable({ planHuOps, loadedPlan, planId, projectDir, savePlanToDisk, eventBase, emitter, logger }) {
  const { autoCertifyPendingHus, assertPlanRunnable } = planHuOps;
  const promoted = autoCertifyPendingHus(loadedPlan);
  if (promoted > 0) {
    await savePlanToDisk(projectDir, loadedPlan);
    logger.info(`Plan ${planId}: auto-certified ${promoted} pending HU(s) — ready to run`);
    emitProgress(emitter, makeEvent("plan:auto-certified", { ...eventBase, stage: "plan" }, {
      message: `Auto-certificadas ${promoted} HU(s) pendientes`,
      detail: { planId, count: promoted }
    }));
  }
  try {
    assertPlanRunnable(loadedPlan, planId);
  } catch (err) {
    logger.error(err.message);
    emitProgress(emitter, makeEvent("plan:no-runnable", { ...eventBase, stage: "plan" }, {
      status: "fail", message: err.message,
      detail: { planId }
    }));
    throw err;
  }
}

/**
 * PR4: when --hu <ids> is set, narrow the batch to those HU ids by
 * marking the rest as `done` in memory. The plan JSON on disk is
 * NOT touched — this is a run-time filter only. Throws when none of
 * the requested ids exist.
 */
function applyHuFilterIfRequested({ huBatch, flags, eventBase, emitter, logger }) {
  if (!huBatch.ok || !flags.hu) return;
  const requested = String(flags.hu).split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) {
    logger.warn(`--hu was empty after parsing — falling back to running every certified HU`);
    return;
  }
  // Humanización IDs: resolver cada ref a un hu.id largo aceptando 3 formas:
  //  1. `hu_<planId>_<NNN>` (id largo, exacto)
  //  2. `INFRA-001` (short_id que el planner asignó)
  //  3. `001` (sufijo numérico — busca un hu.id que termine en `_001`)
  // El resolver es case-insensitive para short_id y sufijo.
  const resolvedIds = new Set();
  const unresolved = [];
  for (const ref of requested) {
    const id = resolveHuRef(ref, huBatch.stories);
    if (id) resolvedIds.add(id);
    else unresolved.push(ref);
  }
  const found = huBatch.stories.filter((s) => resolvedIds.has(s.id));
  if (unresolved.length > 0) {
    logger.warn(`--hu: ignored ${unresolved.length} unknown HU ref(s): ${unresolved.join(", ")}`);
  }
  if (found.length === 0) {
    throw new Error(`--hu: none of the requested HU ref(s) exist in plan ${flags.plan}: ${requested.join(", ")}`);
  }
  for (const story of huBatch.stories) {
    if (!resolvedIds.has(story.id)) story.status = "done";
  }
  huBatch.certified = found.length;
  logger.info(`Plan ${flags.plan}: --hu filter active — ${found.length}/${huBatch.total} HU(s) will run (${found.map((s) => s.id).join(", ")})`);
  emitProgress(emitter, makeEvent("plan:hu-filter", { ...eventBase, stage: "plan" }, {
    message: `--hu filter: ${found.length} HU(s) selected, ${huBatch.total - found.length} skipped`,
    detail: { planId: flags.plan, requested, ignored: unresolved, willRun: found.map((s) => s.id) }
  }));
}

/**
 * Wire the four session-scoped callbacks the run will invoke as it
 * progresses: PR1 live status (per HU), PR3 live outcome (per HU
 * exit), and the syncResultsToPlan rollup (end-of-run).
 */
function wirePlanCallbacks({ session, loadedPlan, projectDir, syncResultsToPlan, savePlanToDisk, planHuOps, logger }) {
  setPlanRef(session, { planId: loadedPlan.planId, projectDir });
  setPlanSyncCallback(session, async (subResult) => {
    syncResultsToPlan(loadedPlan, subResult);
    await savePlanToDisk(projectDir, loadedPlan);
  });
  // PR1: live HU status. Without this the plan only updates at
  // end-of-run and the board's Kanban looks frozen during execution.
  // (`planHuOps` was loaded above for PR-E auto-certify — reuse the
  // reference to stay under the dynamic-import budget.)
  const { updateHuStatus: updateHuStatusFn, setHuOutcome: setHuOutcomeFn } = planHuOps;
  setLiveStatusUpdater(session, async (huId, status) => {
    try {
      if (!updateHuStatusFn(loadedPlan, huId, status)) return;
      await savePlanToDisk(projectDir, loadedPlan);
    } catch (err) {
      logger?.warn?.(`Live status update failed for ${huId}: ${err.message}`);
    }
  });
  // PR3: per-HU outcome. Stamped once per HU at runSingleHu's exit
  // so the board can show the 📄 indicator as soon as each HU
  // finishes (iterations / duration / commits / blockers / summary).
  setLiveOutcomeUpdater(session, async (huId, outcome) => {
    try {
      if (!setHuOutcomeFn(loadedPlan, huId, outcome)) return;
      await savePlanToDisk(projectDir, loadedPlan);
    } catch (err) {
      logger?.warn?.(`Live outcome update failed for ${huId}: ${err.message}`);
    }
  });
}

/**
 * Resuelve una referencia humana a HU al `id` canónico largo. Acepta:
 *   - id largo exacto: `hu_<planId>_<NNN>` → match directo.
 *   - short_id: `INFRA-001`, `AUTH-SIGNUP` → match case-insensitive contra hu.short_id.
 *   - sufijo numérico: `001` → match contra hu.id terminado en `_001`.
 * Devuelve el hu.id largo o null si no resuelve.
 *
 * @param {string} ref
 * @param {Array<{id: string, short_id?: string|null}>} hus
 * @returns {string|null}
 */
function resolveHuRef(ref, hus) {
  if (!ref || !Array.isArray(hus)) return null;
  // Match exacto contra id largo (camino caliente).
  const exact = hus.find((s) => s.id === ref);
  if (exact) return exact.id;
  // Match case-insensitive contra short_id.
  const lower = ref.toLowerCase();
  const byShort = hus.find((s) => s.short_id && String(s.short_id).toLowerCase() === lower);
  if (byShort) return byShort.id;
  // Match por sufijo numérico (`001` → cualquier hu cuyo id termine en `_001`).
  if (/^\d+$/.test(ref)) {
    const padded = ref.padStart(3, "0");
    const bySuffix = hus.find((s) => s.id.endsWith(`_${padded}`));
    if (bySuffix) return bySuffix.id;
  }
  return null;
}

/**
 * Build a single plannedTask string for the non-HU / fallback
 * iteration path. The HU sub-pipeline doesn't read this; only the
 * legacy single-iteration loop does. Identical to the inlined
 * version's behaviour.
 */
function buildPlannedTaskFromLoadedPlan({ task, loadedPlan }) {
  const plan = loadedPlan.plan || (loadedPlan.approach ? { approach: loadedPlan.approach } : null);
  if (plan && typeof plan === "object" && plan.steps) {
    const stepList = plan.steps.map((s, idx) => `${idx + 1}. ${s.description || s}`).join("\n");
    return `${task}\n\n## Implementation Plan\n${plan.approach || ""}\n\n## Steps\n${stepList}`;
  }
  if (typeof plan === "string") {
    return `${task}\n\n## Implementation Plan\n${plan}`;
  }
  if (loadedPlan.approach) {
    return `${task}\n\n## Approach\n${loadedPlan.approach}`;
  }
  return task;
}
