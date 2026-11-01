// KJC-TSK-0542: how one file on disk becomes rows in the board DB: a session.json or a v2 plan.
// sync.js runs them from fullScan and the watcher, and re-exports syncPlanFile.
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import {
  upsertProject,
  upsertStory,
  upsertSession,
  getDb,
  isTombstoned,
  getTombstone,
  removeTombstone,
} from './db.js';
import { publish as publishEvent } from './event-bus.js';
import { isSharedPath } from 'karajan-core/shared-paths';
import {
  deriveProjectIdFromDir,
  canonicalProjectDir,
  titleCaseBasename,
  slugToTitle,
} from './sync-project.js';

/**
 * Skip + best-effort fs cleanup when the resource is tombstoned. Returns
 * true if the caller should bail out (resource is dead).
 *
 * KJC-TSK-0380: without this, every fullScan/chokidar event resurrects
 * resources the user already deleted via the API.
 */
function skipIfTombstoned(resourceType, resourceId, fsPathToRemove) {
  if (!isTombstoned(resourceType, resourceId)) return false;
  if (fsPathToRemove) {
    try { rmSync(fsPathToRemove, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return true;
}

/**
 * Parses a session.json file and syncs to SQLite.
 * @param {string} filePath - Absolute path to session.json
 */
export function syncSessionFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const sessionId = data.id || basename(join(filePath, '..'));

    if (skipIfTombstoned('session', sessionId, dirname(filePath))) return;

    // Resolve which project this session belongs to:
    //   1. If a plan / HU batch already created `auto-<sessionId>`, reuse it
    //      so plan-based runs group with their HU batch.
    //   2. Otherwise fall back to the session's declared `project_id`.
    //   3. Otherwise → REJECT. Orphan sessions (no project_id and no batch)
    //      USED to be promoted to a fake "Orphan sessions" project, which
    //      violated the user's invariant: "Si se crea proyecto y se crean
    //      hus se asocian a proyecto. ES IMPOSIBLE QUE [no exista esa
    //      asociación]". Now we skip them entirely. The fix for the source
    //      (kj run always stamps project_id derived from cwd) lives in
    //      PR-F; this is the safety net so a leftover orphan can never
    //      again appear as a phantom project on the board.
    const autoProjectId = `auto-${sessionId}`;
    const db = getDb();
    const existingBatch = db.prepare('SELECT id FROM projects WHERE id = ?').get(autoProjectId);
    let projectId;
    if (existingBatch) {
      projectId = autoProjectId;
    } else if (data.project_id) {
      projectId = data.project_id;
    } else {
      // Orphan: log + skip. Never promote to "default".
      console.warn(`[sync] Session ${sessionId} has no project_id and no matching batch — skipping (orphan). File: ${filePath}`);
      return;
    }

    // Ensure the project row exists. Skip when an auto-batch owns it already
    // (that row was written with richer metadata and we do
    // not want to overwrite name/total_stories).
    if (!existingBatch) {
      upsertProject({
        id: projectId,
        name: projectId,
        last_activity: data.updated_at || data.created_at || new Date().toISOString(),
        total_stories: 0,
      });
    }

    // Calculate iterations from checkpoints
    const checkpoints = data.checkpoints || [];
    const maxIteration = checkpoints.reduce((max, cp) => Math.max(max, cp.iteration || 0), 0);

    // Calculate duration from first and last checkpoint
    let durationMs = null;
    if (data.created_at && data.updated_at) {
      durationMs = new Date(data.updated_at).getTime() - new Date(data.created_at).getTime();
    }

    // Collect completed stages
    const stagesSet = new Set();
    for (const cp of checkpoints) {
      if (cp.stage && !cp.stage.includes('attempt') && !cp.stage.includes('checkpoint')) {
        stagesSet.add(cp.stage);
      }
    }

    // Project row was created above (unless an auto-batch owns it); the
    // session always has a project to attach to now.

    upsertSession({
      id: sessionId,
      project_id: projectId,
      task: data.task || null,
      status: data.status || 'unknown',
      created_at: data.created_at,
      updated_at: data.updated_at,
      iterations: maxIteration,
      duration_ms: durationMs,
      approved: data.status === 'approved' ? 1 : 0,
      commits: data.commits ? JSON.stringify(data.commits) : null,
      stages_completed: JSON.stringify([...stagesSet]),
      checkpoints: JSON.stringify(checkpoints),
      llm_calls: data.llm_calls ? JSON.stringify(data.llm_calls) : null,
      config_snapshot: data.config_snapshot ? JSON.stringify(data.config_snapshot) : null,
      budget: data.budget ? JSON.stringify(data.budget) : null,
    });

    console.log(`[sync] Synced session ${sessionId}: status=${data.status}, iterations=${maxIteration}`);
    publishEvent({ type: 'session', projectId, sessionId });
  } catch (err) {
    console.error(`[sync] Error syncing session file ${filePath}:`, err.message);
  }
}

/**
 * Sync a v2 plan file (with embedded HUs) to SQLite.
 * Plans are the authoritative source — replaces hu-stories for plan-based runs.
 */
export function syncPlanFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // KJC-BUG-0124 (issue #1277): a strict `version !== 2` silently hid
    // every plan whose version drifted — the board showed 0 stories with no
    // trace, and users concluded their work was lost. Tolerant now: any
    // v2+ plan syncs, with a LOUD warn on version drift (fired before the
    // empty check so drift is visible even on empty plans). Pre-v2 plans
    // keep their historical silent skip (they never synced and carry no
    // hus[]), and an empty v2 plan has nothing to sync — skipping it
    // loses nothing.
    if (typeof data.version !== 'number' || data.version < 2) return;
    if (data.version > 2) {
      console.warn(`[sync] ${filePath}: plan version ${data.version} (expected 2) — syncing anyway; re-save with current kj to normalize`);
    }
    if (!Array.isArray(data.hus) || data.hus.length === 0) return;

    // Bug fix: pre-patch, `projectId = data.planId` — every plan was a separate
    // "project" on the board, so 2 464 plans across the same repo produced
    // 2 464 boxes in the UI instead of one. Now we derive the project from
    // the stamped `projectDir` so every plan for the same source tree groups
    // under a single board entry. Legacy plans without `projectDir` still
    // fall back to `planId` (conservative — they at least continue to show
    // up, just each on its own card).
    // KJC-BUG-0160: la identidad es el ROOT del repo — un plan creado desde
    // un worktree/carril agrupa bajo el mismo proyecto que el árbol principal.
    const canonicalDir = data.projectDir ? canonicalProjectDir(data.projectDir) : null;
    const projectId = canonicalDir ? deriveProjectIdFromDir(canonicalDir) : data.planId;

    if (skipIfTombstoned('plan', data.planId, filePath)) return;
    // KJC-BUG-0055 (supersedes KJC-BUG-0050): gating por timestamp.
    // El "fix" anterior quitaba el tombstone del proyecto en CUALQUIER
    // llegada de plan — eso resucitaba proyectos borrados cuando un plan
    // anterior reaparecía (DB nueva + plan-files viejos en disco) o
    // cuando un fullScan posterior los re-encontraba. Comportamiento:
    //   • plan.updatedAt/createdAt > tombstone.deleted_at → el usuario
    //     ha generado el plan DESPUÉS de borrar el proyecto → revivir.
    //   • plan.updatedAt/createdAt <= tombstone.deleted_at → plan stale
    //     pre-existente al borrado → respetar el tombstone y borrar el
    //     fichero en disco para que no vuelva a re-importarse.
    const projectTomb = getTombstone('project', projectId);
    if (projectTomb) {
      const planTime = data.updatedAt || data.createdAt || null;
      const planTs = planTime ? Date.parse(planTime) : NaN;
      const tombTs = Date.parse(projectTomb.deleted_at);
      if (Number.isFinite(planTs) && planTs > tombTs) {
        console.log(`[sync] Project ${projectId} resucitado: plan ${data.planId} es más reciente (${planTime}) que el tombstone (${projectTomb.deleted_at}).`);
        removeTombstone('project', projectId);
      } else {
        console.log(`[sync] Plan ${data.planId} ignorado: proyecto ${projectId} tombstoned (${projectTomb.deleted_at}); borrando ${filePath}.`);
        try { rmSync(filePath, { force: true }); } catch { /* best effort */ }
        return;
      }
    }
    // Human-friendly project name resolution order (most-specific first):
    //   1. plan.name explicitly set by the user / planner ("Linux Assistant
    //      Orchestrator" — preserved across renames done from the board).
    //   2. titleCaseBasename(projectDir) — derived from the cwd of the
    //      original kj plan invocation. NOTE: this is the SUBCARPETA of the
    //      projectDir, NOT necessarily where the work happens. If the user
    //      ran `kj plan` from inside `…/karajan-code/packages/hu-board/`
    //      with a SPEC about "Linux Assistant", the basename here would
    //      misleadingly say "Hu Board" — that's why plan.name wins.
    //   3. slugToTitle of the task / projectId as a last resort.
    // KJC-BUG-0162: the default backlog plan is named "brain-backlog" — a
    // DEFAULT, not a user choice. Every project synced through it ended up
    // named "brain-backlog", indistinguishable in the picker. Only a real,
    // user-given plan name may override the repo-derived name.
    const userGivenName = data.name && data.name !== 'brain-backlog' ? data.name : null;
    const projectName = userGivenName
      || (canonicalDir ? titleCaseBasename(basename(canonicalDir)) : null)
      || slugToTitle(data.task || '')
      || projectId;

    // KJC-PRP-0002 PR3: stamp `is_shared` from the path (authoritative — works
    // even for legacy plan files without the `shared:true` envelope marker).
    // OR with existing value so a single shared plan promotes the project,
    // while unsharing the LAST shared plan still leaves the flag set (we
    // clear it lazily only when the user explicitly tombstones / re-creates).
    upsertProject({
      id: projectId,
      name: projectName,
      last_activity: data.updatedAt || data.createdAt || new Date().toISOString(),
      total_stories: data.hus.length,
      is_shared: isSharedPath(filePath) || data.shared === true ? 1 : undefined,
    });

    for (let i = 0; i < data.hus.length; i += 1) {
      const hu = data.hus[i];
      const acList = Array.isArray(hu.acceptance_criteria) ? hu.acceptance_criteria : [];
      // Only count tests that carry real content. `kj plan` stamps a
      // placeholder like `["npx vitest run ..."]` on every HU — those
      // DO count as 1 test each. But empty strings / null entries
      // (which show up in half-baked plans) must not inflate the
      // badge to "🧪 1 test" on a HU that effectively has none.
      // Drop empty entries but accept BOTH legacy shapes and the
      // v2.7.5 structured form. The original anti-junk filter only
      // knew the legacy shape (`name|title|description|given|gherkin|
      // scope`) and silently nuked every test produced by the
      // tests-synthesizer (which emits `{type, content, file?}`),
      // leaving every HU flagged "missing test contract" on the
      // board even though the plan JSON had 4 tests apiece.
      const testList = (Array.isArray(hu.acceptance_tests) ? hu.acceptance_tests : [])
        .filter((t) => {
          if (!t) return false;
          if (typeof t === 'string') return t.trim().length > 0;
          if (typeof t !== 'object') return false;
          // v2.7.5 structured form — primary shape going forward.
          if (typeof t.content === 'string' && t.content.trim().length > 0) return true;
          // Legacy shapes kept for back-compat with hand-edited plans.
          return Boolean(t.name || t.title || t.description || t.given || t.gherkin || t.scope);
        });
      const blockedByList = Array.isArray(hu.blocked_by) ? hu.blocked_by : [];
      const acText = acList.length > 0 ? JSON.stringify(acList) : null;

      upsertStory({
        id: `${projectId}::${hu.id}`,
        project_id: projectId,
        session_id: projectId,
        status: hu.status || 'pending',
        title: hu.title || hu.id,
        original_text: hu.scope || null,
        certified_as: null,
        certified_want: hu.scope || null,
        certified_so_that: null,
        quality_total: null,
        quality_d1: null, quality_d2: null, quality_d3: null,
        quality_d4: null, quality_d5: null, quality_d6: null,
        antipatterns: null,
        ac_format: acText ? 'list' : null,
        acceptance_criteria: acText,
        created_at: hu.createdAt,
        updated_at: hu.updatedAt,
        certified_at: null,
        // Stamp plan_id so the PATCH / mark-ready endpoints can locate
        // the source plan JSON without walking the plans dir.
        plan_id: data.planId,
        // Denormalised counters + deps so the card renders "3 ACs ·
        // 2 tests · waits for lao-001" without every client parsing JSON.
        ac_count: acList.length,
        test_count: testList.length,
        blocked_by: blockedByList.length > 0 ? JSON.stringify(blockedByList) : null,
        // Full test list goes to SQLite too so the modal can show
        // "🧪 2 tests" next to the list. Pre-patch the card showed
        // test_count but the modal had nothing to render.
        acceptance_tests: testList.length > 0 ? JSON.stringify(testList) : null,
        // Index in plan.hus[] — used by getStoriesByProject to order
        // cards topologically (roots first, dependents last).
        plan_order: i,
        // Spec mapping (PR C): "implements §5.3" trace pointer.
        spec_section: typeof hu.spec_section === 'string' && hu.spec_section.trim() ? hu.spec_section.trim() : null,
        // PR3: per-HU outcome (iterations, duration, commits,
        // blockers, summary). Stored as a JSON string in SQLite —
        // the front parses on read. Null until hu-sub-pipeline
        // stamps it at the end of each HU.
        outcome: hu.outcome ? JSON.stringify(hu.outcome) : null,
        // KJC-TSK-0394: result (pass|fail|partial|null) ortogonal al status.
        // Distinto de `outcome` (blob JSON) — esto es el enum corto para
        // badge ✓/✗ en la card.
        result: hu.result || null,
        // KJC-TSK-0406: coder_model y reviewer_model por HU. Reflejan
        // qué modelo se va a usar (o se usó) en este HU. El modal del
        // board los muestra y permite cambiarlos antes de run.
        coder_model: hu.coder_model || null,
        reviewer_model: hu.reviewer_model || null,
        coder_provider: hu.coder_provider || null,
        reviewer_provider: hu.reviewer_provider || null,
        // KJC-PRP-0002 PR6: optional handle of the owner of this HU
        // (free-form string). Only surfaced in UI when project is_shared,
        // but stored unconditionally so values survive share/unshare flips.
        assignee: typeof hu.assignee === 'string' && hu.assignee.trim() ? hu.assignee.trim() : null,
      });
    }

    console.log(`[sync] Plan ${projectId}: ${data.hus.length} HUs (${projectName})`);
    publishEvent({ type: 'plan', projectId, planId: data.planId });
  } catch (err) {
    console.error(`[sync] Failed to sync plan ${filePath}: ${err.message}`);
  }
}
