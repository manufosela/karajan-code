import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

/** Async existence probe (KJC-TSK-0539 — no sync fs in handlers). */
const pathExists = (p) => fsp.access(p).then(() => true, () => false);

/**
 * mtime-keyed cache for parsed plan JSON (KJC-TSK-0539). The plan scans
 * used to re-read and re-parse every plan file on EVERY request; with N
 * plans and the board polling, that was O(N) parses per poll. The cache
 * serves the parsed object while the file's mtime is unchanged and
 * re-reads transparently when kj writes the plan.
 */
const planFileCache = new Map();
export async function readPlanCached(p) {
  const { mtimeMs } = await fsp.stat(p);
  const hit = planFileCache.get(p);
  if (hit && hit.mtimeMs === mtimeMs) return hit.plan;
  const plan = JSON.parse(await fsp.readFile(p, 'utf8'));
  planFileCache.set(p, { mtimeMs, plan });
  return plan;
}
import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import {
  getDashboardStats,
  getProjects,
  getStoriesByProject,
  getStoryDetail,
  getSessionsByProject,
  getSessionDetail,
  deleteProject,
  deleteSession,
  getKjHome,
  getHuBoardRunsDir,
  getHuBoardPlansDir,
  getHuBoardPlansDirs,
  getStoryRow,
  listPlanIdsForProject,
  updateStoryStatus,
  setProjectIsTest,
  getProjectCost,
} from '../db.js';
import { fullScan } from '../sync.js';
import { setHuStatus, setHuFields, markPlanReady, runPlan, renameProject, revertHuFromSnapshot } from '../plan-mutations.js';
import { getActiveRuns } from '../run-tracker.js';
import { subscribe as subscribeEvents } from '../event-bus.js';
import { runKjCommand, listSupportedCommands } from '../command-runner.js';
import { runPreflight } from '../preflight.js';
import { readConfig, writeConfigPatch } from '../config-yaml.js';
import { BOOT_TIME, PKG_VERSION } from '../boot-info.js';
import { addTombstone, getDb, isTombstoned as isTombstonedFn, removeTombstone, listTombstones } from '../db.js';
import { publish as publishEvent } from '../event-bus.js';

const router = Router();

/**
 * GET /api/version - Server version + boot timestamp.
 * The client polls this every 30s; if `boot_time` differs from the first
 * response, the server restarted and the client triggers a reload to pick
 * up any new HTML/JS (KJC-TSK-0379).
 */
router.get('/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: PKG_VERSION, boot_time: BOOT_TIME });
});

/**
 * GET /api/standby — KJC-TSK-0414 PR4. Lista sesiones hibernadas.
 * Devuelve [{ sessionId, planId, huId, role, cooldownUntil, reason, ... }]
 * El front renderiza un badge "💤 standby · resume en HH:MM:SS" por sesión.
 */
router.get('/standby', async (_req, res) => {
  try {
    // KJC-TSK-0632: resolve from karajan-core directly — the CLI's
    // src/brain/standby-store.js is just a re-export shim of this.
    const { listPendingStandby } = await import('karajan-core/standby-store');
    const sessions = listPendingStandby();
    res.set('Cache-Control', 'no-store');
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Resolve the hu-stories dir where batch.json files live.
 */
function huStoriesDir() {
  return path.join(getKjHome(), 'hu-stories');
}

/**
 * GET /api/dashboard - Global dashboard statistics.
 */
router.get('/dashboard', (_req, res) => {
  try {
    const stats = getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects - List all projects with story counts.
 */
router.get('/projects', (_req, res) => {
  try {
    const projects = getProjects();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id - Project detail.
 */
router.get('/projects/:id', (req, res) => {
  try {
    const projects = getProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/projects/:id/name — PR-G: rename a project.
 *
 * Updates plan.name on every plan JSON belonging to the project AND
 * the projects.name column directly so the UI reflects the new name
 * on the next render. Body: { name: "Linux Assistant Orchestrator" }.
 */
router.put('/projects/:id/name', (req, res) => {
  try {
    const result = renameProject({ projectId: req.params.id, name: req.body?.name });
    if (!result.ok) {
      const code = /no encontrado/i.test(result.error) ? 404 : 400;
      return res.status(code).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/projects/:id/is-test — KJC-TSK-0371 (board polish #3).
 *
 * Sets/clears the per-project ephemeral-cleanup override. The
 * heuristic (id under tmp_/test_/demo_/kj-test- AND last_activity
 * older than 24h → auto-delete on next board start) is the default.
 * `is_test` lets the user override per-project:
 *   - body { is_test: 1 }    → always treat as ephemeral
 *   - body { is_test: 0 }    → NEVER auto-clean (keep this one)
 *   - body { is_test: null } → revert to the default heuristic
 *
 * Sending anything else is a 400 — explicit ternary, no truthy/
 * falsy coercion, because that exact distinction is what the
 * cleaner relies on.
 */
router.patch('/projects/:id/is-test', (req, res) => {
  const raw = req.body?.is_test;
  // Accept the three legal sentinel values explicitly — undefined
  // (key missing) is rejected because this endpoint only exists to
  // set or clear, not to "leave as-is".
  const allowed = raw === 0 || raw === 1 || raw === null;
  if (!allowed) {
    return res.status(400).json({ error: 'is_test must be 0, 1, or null' });
  }
  try {
    const ok = setProjectIsTest(req.params.id, raw);
    if (!ok) return res.status(404).json({ error: 'project not found' });
    res.json({ ok: true, project_id: req.params.id, is_test: raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/preflight — Project readiness checks.
 *
 * Returns the same shape regardless of the project's state. Each
 * check carries a status (ok|warn|fail|info), a plain-Spanish
 * detail and (when relevant) a `consequence` describing what the
 * user loses if it stays unfixed. Powers both:
 *   - the panel at the top of the board (always visible)
 *   - the safety modal that appears before ▶ Run plan / ▶ Run HU
 *     when there are blockers or warnings
 *
 * The route resolves projectDir by reading the first plan it can
 * find for this project (plans carry projectDir since v2.7.4). If
 * the project has no plans on disk we still return the env-only
 * checks (Node, Karajan, agents, config) so the user gets feedback
 * even before they generate their first plan.
 */
router.get('/projects/:id/preflight', async (req, res) => {
  try {
    const projectId = req.params.id;
    let projectDir = null;
    // KJC-BUG-0059 (v2.19.3): scan plans in BOTH the canonical
    // ~/.karajan/plans/ AND the legacy ~/.kj/plans/ — the legacy
    // fallback covers users who started the board before running any
    // `kj` command on a fresh install (so the auto-migrator from
    // v2.19.0 has not fired yet). Pre-fix, this endpoint hard-coded
    // ~/.kj/plans/ as the default, missing every plan post-2.19.0
    // → board card showed "directorio del proyecto: no detectado"
    // even though the plan on disk had a valid projectDir.
    try {
      outer: for (const root of getHuBoardPlansDirs()) {
        const plansDir = path.join(root, projectId);
        if (!(await pathExists(plansDir))) continue;
        for (const f of (await fsp.readdir(plansDir)).filter((x) => x.endsWith('.json'))) {
          try {
            const plan = await readPlanCached(path.join(plansDir, f));
            if (plan?.projectDir) { projectDir = plan.projectDir; break outer; }
          } catch { /* try next file */ }
        }
      }
    } catch { /* projectDir stays null → preflight will report it */ }
    const result = await runPreflight({ projectId, projectDir });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/plans-outcome — Plan-level rollups (PR3).
 *
 * Reads every plan JSON for the project and returns the lightweight
 * shape the board needs to render the "Plan finalizado · 8 done · 2
 * failed · 15 min" banner. Plans that haven't finished yet have a
 * null outcome — the front handles that by hiding the banner.
 */
router.get('/projects/:id/plans-outcome', async (req, res) => {
  try {
    const projectId = req.params.id;
    // KJC-BUG-0059 (v2.19.3): scan canonical + legacy roots so users
    // who have not yet run the auto-migrator still see their plans.
    const out = [];
    for (const root of getHuBoardPlansDirs()) {
      const plansDir = path.join(root, projectId);
      if (!(await pathExists(plansDir))) continue;
      for (const f of (await fsp.readdir(plansDir)).filter(n => n.endsWith('.json'))) {
        try {
          const plan = await readPlanCached(path.join(plansDir, f));
          if (plan?.version !== 2) continue;
          out.push({
          planId: plan.planId,
          name: plan.name || (plan.task ? plan.task.slice(0, 80) : plan.planId),
          status: plan.status || 'draft',
          updatedAt: plan.updatedAt || null,
          outcome: plan.outcome || null,
          huCount: Array.isArray(plan.hus) ? plan.hus.length : 0,
        });
      } catch { /* skip unreadable plan */ }
      }
    }
    res.json({ projectId, plans: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/stories - Stories for a project.
 */
router.get('/projects/:id/stories', (req, res) => {
  try {
    const stories = getStoriesByProject(req.params.id);
    res.json(stories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stories/:id - Story detail with quality scores and context requests.
 */
router.get('/stories/:id', (req, res) => {
  try {
    const story = getStoryDetail(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    res.json(story);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/cost - Aggregated $ cost for a project (KJC-TSK-0516).
 * Sums stories.cost_usd, groups by plan_id, returns 404 if project missing.
 */
router.get('/projects/:id/cost', (req, res) => {
  try {
    const cost = getProjectCost(req.params.id);
    if (!cost) return res.status(404).json({ error: 'Project not found' });
    res.json(cost);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/sessions - Sessions for a project.
 */
router.get('/projects/:id/sessions', (req, res) => {
  try {
    const sessions = getSessionsByProject(req.params.id);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions/:id - Session detail with stages, commits, duration.
 */
router.get('/sessions/:id', (req, res) => {
  try {
    const session = getSessionDetail(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Parse JSON fields for the response
    const parsed = { ...session };
    for (const field of ['checkpoints', 'llm_calls', 'config_snapshot', 'budget', 'commits', 'stages_completed']) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        try { parsed[field] = JSON.parse(parsed[field]); } catch { /* keep as string */ }
      }
    }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions - All sessions across all projects.
 */
router.get('/sessions', (_req, res) => {
  try {
    const allProjects = getProjects();
    const sessions = [];
    for (const p of allProjects) {
      sessions.push(...getSessionsByProject(p.id));
    }
    // Also get default project sessions
    sessions.push(...getSessionsByProject('default'));
    // Deduplicate
    const seen = new Set();
    const unique = sessions.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    unique.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.json(unique);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/projects/:id - Cascade delete project + its stories + sessions.
 * Also removes the hu-stories/<id>/ directory from disk so the next sync
 * does not re-import it.
 */
router.delete('/projects/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Gather filesystem paths to remove BEFORE deleting DB rows so we
    // can stop the next sync from resurrecting anything.
    const db = getDb();
    const storyIds = db.prepare('SELECT id FROM stories WHERE project_id = ?').all(id).map((r) => r.id);
    const sessionIds = db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(id).map((r) => r.id);
    // KJC-BUG-0055: honour KJ_PLANS_DIR (the env override the sync /
    // cleanup-zombies layers already respect). Previously hardcoded to
    // ~/.kj/plans relative to KJ_HOME's parent, which broke when the
    // two homes were configured separately and left orphan plan dirs
    // on disk after a 🗑️ delete.
    // KJC-BUG-0059 (v2.19.3): when removing a deleted project's
    // residual plan dirs, sweep BOTH the canonical and legacy roots
    // so the cleanup is consistent for users mid-migration.
    const fsPaths = [
      ...storyIds.map((sid) => path.join(huStoriesDir(), sid)),
      ...sessionIds.map((sid) => path.join(getKjHome(), 'sessions', sid)),
      ...getHuBoardPlansDirs().map((root) => path.join(root, id)),
    ];

    const existed = deleteProject(id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });

    // Tombstone the project AND its children so chokidar / fullScan
    // can't bring them back via syncStoryFile / syncSessionFile.
    addTombstone('project', id, { source: 'api', fsPaths });
    for (const sid of storyIds) addTombstone('story', sid, { source: 'api' });
    for (const sid of sessionIds) addTombstone('session', sid, { source: 'api' });

    // Best-effort fs cleanup; failure does NOT undo the tombstones.
    let pathsRemoved = 0;
    for (const p of fsPaths) {
      try { await fsp.rm(p, { recursive: true, force: true }); pathsRemoved++; } catch { /* */ }
    }
    res.json({ deleted: true, pathsRemoved, tombstoned: 1 + storyIds.length + sessionIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/prompts/:promptId - Discard a pending prompt the runner left
 * behind (KJC-TSK-0380). Removes the RPC files from disk, tombstones the
 * prompt id so a stale chokidar event can't recreate it, and emits a
 * `prompt:resolved` event so all open boards close the modal.
 */
router.delete('/prompts/:promptId', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    const dir = promptsDir();
    const main = path.join(dir, `${promptId}.json`);
    const answer = path.join(dir, `${promptId}.answer.json`);
    let removed = 0;
    for (const p of [main, answer]) {
      try { await fsp.unlink(p); removed++; } catch { /* missing is fine */ }
    }
    addTombstone('prompt', promptId, { source: 'api', fsPaths: [main, answer] });
    // Re-use the same event the runner emits when answered, so any open
    // modal in any connected board client closes itself.
    publishEvent({ type: 'prompt-resolved', promptId });
    res.json({ deleted: true, filesRemoved: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/stories/:id - Delete a single story.
 *
 * Tombstones the story (KJC-TSK-0380) and removes its batch directory
 * from `~/.karajan/hu-stories/<id>/` so the next sync does NOT re-import
 * it. Pre-tombstones this endpoint was a DB-only soft hide that the next
 * chokidar event undid silently.
 */
router.delete('/stories/:id', (req, res) => {
  // KJC-TSK-0671 (absolute product rule): stories are NEVER deleted — the
  // delete-and-recreate "fix" agents improvise loses history and produced
  // the field saga this closes. Discard goes through the lifecycle instead.
  res.status(405).json({
    error: 'Stories are never deleted. Discard one with: kj hu move <id> skipped '
      + '(archived, history kept). Dashboard warnings are fixed with the command '
      + 'they name — see kj brief board.',
  });
});

/**
 * DELETE /api/sessions/:id - Delete a single session.
 *
 * Tombstones + removes `~/.karajan/sessions/<id>/` (KJC-TSK-0380).
 */
router.delete('/sessions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const dir = path.join(getKjHome(), 'sessions', id);
    const ok = deleteSession(id);
    if (!ok) return res.status(404).json({ error: 'Session not found' });
    addTombstone('session', id, { source: 'api', fsPaths: [dir] });
    let dirRemoved = false;
    try { await fsp.rm(dir, { recursive: true, force: true }); dirRemoved = true; } catch { /* */ }
    res.json({ deleted: true, dirRemoved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/plans/:planId - Delete a single plan file.
 *
 * Removes `~/.kj/plans/<projectSlug>/plan-<planId>.json` and tombstones
 * the plan id so the next watcher event doesn't re-sync it. Does NOT
 * delete the project: a project can have multiple plans, deleting one
 * plan only removes that plan's HUs from the board.
 */
router.delete('/plans/:planId', async (req, res) => {
  try {
    const planId = req.params.planId;
    // Locate the plan file by scanning both canonical and legacy plans
    // roots — KJC-BUG-0059 (v2.19.3). Pre-fix this hard-coded
    // `getKjHome()/../.kj/plans` which silently misses plans saved by
    // post-2.19.0 callers under `~/.karajan/plans/`.
    let foundPath = null;
    try {
      outer: for (const plansRoot of getHuBoardPlansDirs()) {
        if (!(await pathExists(plansRoot))) continue;
        for (const projSlug of await fsp.readdir(plansRoot)) {
          const candidate = path.join(plansRoot, projSlug, `plan-${planId}.json`);
          if (await pathExists(candidate)) { foundPath = candidate; break outer; }
        }
      }
    } catch { /* plansRoot missing */ }
    addTombstone('plan', planId, { source: 'api', fsPaths: foundPath ? [foundPath] : [] });
    if (foundPath) { try { await fsp.unlink(foundPath); } catch { /* */ } }
    res.json({ deleted: true, fileRemoved: !!foundPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tombstones - List every active tombstone for diagnostics.
 *
 * Returns rows ordered by deleted_at DESC; useful for the diagnostics
 * pane and for the cleanup script (KJC-TSK-0380 PR-C).
 */
router.get('/tombstones', (_req, res) => {
  try {
    res.json(listTombstones());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tombstones/:type/:id/restore - Bring a buried id back to
 * life. The next sync will then re-import the resource if its filesystem
 * source still exists. Idempotent: returns false when nothing to remove.
 */
router.post('/tombstones/:type/:id/restore', (req, res) => {
  try {
    const removed = removeTombstone(req.params.type, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Tombstone not found' });
    res.json({ restored: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/stories/:id - Edit a single HU.
 *
 * Accepts two shapes in the same call (both optional, either or both
 * can be present):
 *
 *   { status: "pending" | "certified" | "done" | "needs_context" }
 *     → changes the lifecycle state (original PATCH semantics).
 *
 *   { title?, scope?, task_type?, acceptance_criteria?,
 *     acceptance_tests?, blocked_by? }
 *     → edits the user-facing fields in place. Whitelist mirrors
 *     plan-hu-ops::updateHu so CLI and board stay aligned.
 *
 * When both are present we apply status last — the status change
 * transitions the plan lifecycle and can rewrite plan.status, whereas
 * field edits are local to the HU and should never fight the status
 * auto-promotion.
 *
 * The row id on the board is `${projectId}::${huId}` — split here to
 * feed the plan-mutation helpers. The source-of-truth plan JSON is
 * rewritten before we ack, then re-synced into SQLite, so a reload
 * renders the committed state.
 */
// KJC-TSK-0394 PR6 (AC 6): el PATCH endpoint sólo acepta el modelo
// canónico {pending, running, done}. Status legacy (`certified`,
// `coding`, `reviewing`, `failed`, `blocked`, `needs_context`) siguen
// vivos en plans existentes y los traduce la UI con canonicalStatus(),
// pero NO pueden ser seteados por escrituras nuevas — devolvemos 400
// con `suggestion` apuntando al mapping correcto. `running` queda fuera
// del dropdown del modal (lifecycle del orquestador), pero el endpoint
// lo acepta por si un programa externo lo necesita.
const ALLOWED_STORY_STATUSES = new Set(['pending', 'running', 'done']);
// Mapping canónico para la sugerencia del 400 cuando el caller manda
// un valor legacy. Mantenemos la regla viva en src/plan/plan-schema.js
// (mapLegacyStatusToResult) — esta tabla es sólo el subset accionable
// desde el endpoint (status + result).
const LEGACY_STATUS_SUGGESTION = {
  certified: { status: 'done', result: 'pass' },
  failed: { status: 'pending', result: 'fail' },
  coding: { status: 'running', result: null },
  reviewing: { status: 'running', result: null },
  blocked: { status: 'pending', result: null },
  needs_context: { status: 'pending', result: null },
};
// KJC-TSK-0406: coder_model y reviewer_model son editables desde el
// modal del board. Independientes — el usuario puede subir el reviewer
// y bajar el coder sin afectar al resto del plan.
// KJC-PRP-0002 PR6: `assignee` is editable from the board modal when the
// project is team-shared. The whitelist itself is project-agnostic — the
// modal hides the input on non-shared projects, but accepting the field
// here doesn't hurt (sync just stores it).
const EDITABLE_HU_FIELDS = ['title', 'scope', 'task_type', 'acceptance_criteria', 'acceptance_tests', 'blocked_by', 'coder_model', 'reviewer_model', 'coder_provider', 'reviewer_provider', 'assignee'];

router.patch('/stories/:id', (req, res) => {
  try {
    const body = req.body || {};
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const fieldPatch = {};
    for (const k of EDITABLE_HU_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) fieldPatch[k] = body[k];
    }
    const hasFieldEdit = Object.keys(fieldPatch).length > 0;

    if (!hasStatus && !hasFieldEdit) {
      return res.status(400).json({
        error: `Body must include status or one of: ${EDITABLE_HU_FIELDS.join(', ')}`,
      });
    }
    if (hasStatus && !ALLOWED_STORY_STATUSES.has(body.status)) {
      // KJC-TSK-0394 PR6 (AC 6): si el caller manda un status legacy,
      // devolvemos un 400 con `suggestion` apuntando al mapping canónico.
      // Una herramienta externa puede leer el body, aplicar el mapeo y
      // re-intentar — sin tener que descubrir la tabla por ensayo y error.
      const suggestion = LEGACY_STATUS_SUGGESTION[body.status] || null;
      return res.status(400).json({
        error: `status must be one of: ${[...ALLOWED_STORY_STATUSES].join(', ')}`,
        suggestion,
      });
    }

    const row = getStoryRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Story not found' });
    if (!row.plan_id) {
      return res.status(409).json({
        error: 'Story is not backed by a plan file (legacy row). Re-run `kj plan` to re-import it.',
      });
    }
    const huId = req.params.id.includes('::')
      ? req.params.id.split('::').slice(1).join('::')
      : req.params.id;

    let updatedHu;
    if (hasFieldEdit) {
      const fieldResult = setHuFields({
        planId: row.plan_id,
        huId,
        patch: fieldPatch,
        projectId: row.project_id,
      });
      if (!fieldResult.ok) {
        // KJC-TSK-0401: validación de blocked_by devuelve 400 con cycle?
        // info para que el board destaque la cadena en la UI. Resto de
        // fallos siguen devolviendo 404 (plan / hu no encontrados).
        if (fieldResult.code === 'INVALID_BLOCKED_BY') {
          return res.status(400).json({ error: fieldResult.error, cycle: fieldResult.cycle });
        }
        return res.status(404).json({ error: fieldResult.error });
      }
      updatedHu = fieldResult.hu;
    }

    let statusResult;
    if (hasStatus) {
      statusResult = setHuStatus({
        planId: row.plan_id,
        huId,
        status: body.status,
        projectId: row.project_id,
      });
      if (!statusResult.ok) return res.status(404).json({ error: statusResult.error });
    }

    res.json({
      updated: true,
      id: req.params.id,
      status: statusResult ? statusResult.status : undefined,
      planStatus: statusResult ? statusResult.planStatus : undefined,
      hu: updatedHu,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stories/:id/undo — KJC-TSK-0408: revert a HU.
 *
 * Restaura los ficheros del workspace al snapshot pre-run guardado por
 * la pipeline. Marca status=pending + result=null + outcome.reverted=true
 * para que el usuario pueda relanzar la HU con otros modelos.
 *
 * Falla con 400 si la HU no tiene snapshot (HUs anteriores al hook).
 * Falla con 404 si plan/HU no existe.
 */
router.post('/stories/:id/undo', async (req, res) => {
  try {
    const row = getStoryRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Story not found' });
    if (!row.plan_id) {
      return res.status(409).json({ error: 'Story sin plan_id — legacy row no soportada.' });
    }
    const huId = req.params.id.includes('::')
      ? req.params.id.split('::').slice(1).join('::')
      : req.params.id;
    const result = await revertHuFromSnapshot({ planId: row.plan_id, huId, projectId: row.project_id });
    if (!result.ok) {
      const code = /not found|no encontrado/i.test(result.error) ? 404 : 400;
      return res.status(code).json({ error: result.error });
    }
    res.json({ ok: true, id: req.params.id, sha: result.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plans/:planId/ready - Bulk-certify every pending HU of a plan.
 * Equivalent to the CLI `kj plan ready <planId>`. Body is optional — if the
 * client knows the projectId we use it as a fast path, otherwise we fall
 * back to scanning the plans dir.
 */
router.post('/plans/:planId/ready', (req, res) => {
  try {
    const { projectId } = req.body || {};
    const result = markPlanReady({ planId: req.params.planId, projectId });
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ready: true, planId: req.params.planId, count: result.count, planStatus: result.planStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:id/ready - Sugar: mark every plan of a project ready
 * in one call. Lets the board expose a single "Mark all certified" button
 * per project view without the UI having to enumerate plan ids first.
 */
router.post('/projects/:id/ready', (req, res) => {
  try {
    const planIds = listPlanIdsForProject(req.params.id);
    if (planIds.length === 0) {
      return res.status(404).json({ error: 'No plan-backed stories for this project' });
    }
    const results = [];
    for (const planId of planIds) {
      const r = markPlanReady({ planId, projectId: req.params.id });
      results.push({ planId, ...r });
    }
    const totalCertified = results
      .filter((r) => r.ok)
      .reduce((acc, r) => acc + r.count, 0);
    res.json({
      ready: true,
      projectId: req.params.id,
      plans: results,
      totalCertified,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Resolve the prompts directory the runner writes RPC packets to.
 * Same convention as src/utils/board-prompt-bridge.js on the runner.
 */
function promptsDir() {
  return path.join(getKjHome(), 'prompts');
}

/**
 * GET /api/prompts - List currently pending prompts. The runner is
 * blocked on each one waiting for an answer; the board reads this on
 * boot to surface modals for prompts that were already pending when
 * the page loaded (the SSE event fires only on new arrivals).
 */
// KJC-BUG-0038: prompts whose runner crashed leave the .json behind in
// ~/.kj/prompts/. Without a TTL, every board reload re-shows the zombie
// modal "Karajan needs an answer" with no runner behind it — the user
// can answer but nothing happens. 30 minutes covers the longest legitimate
// Solomon escalation; anything older is a crashed runner.
const PROMPT_ZOMBIE_TTL_MS = 30 * 60 * 1000;

router.get('/prompts', async (_req, res) => {
  try {
    const dir = promptsDir();
    if (!(await pathExists(dir))) return res.json([]);
    const entries = await fsp.readdir(dir);
    const result = [];
    const now = Date.now();
    for (const name of entries) {
      if (!name.endsWith('.json') || name.endsWith('.answer.json')) continue;
      const promptId = name.replace(/\.json$/, '');
      const mainPath = path.join(dir, name);
      const answerPath = path.join(dir, `${promptId}.answer.json`);
      // KJC-TSK-0380 — skip tombstoned prompts and clean their files.
      if (isTombstonedFn('prompt', promptId)) {
        try { await fsp.unlink(mainPath); } catch { /* */ }
        try { await fsp.unlink(answerPath); } catch { /* */ }
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(await fsp.readFile(mainPath, 'utf-8'));
      } catch { continue; /* malformed — skip */ }
      // KJC-BUG-0038: zombie detection. Prefer parsed.createdAt; fall back
      // to mtime if the runner skipped the timestamp (older formats).
      const createdMs = Date.parse(parsed?.createdAt || '');
      const ageRef = Number.isFinite(createdMs) ? createdMs : await safeMtime(mainPath);
      if (ageRef && (now - ageRef) > PROMPT_ZOMBIE_TTL_MS) {
        try { await fsp.unlink(mainPath); } catch { /* */ }
        try { await fsp.unlink(answerPath); } catch { /* */ }
        addTombstone('prompt', promptId, { source: 'zombie-ttl', fsPaths: [mainPath, answerPath] });
        continue;
      }
      result.push(parsed);
    }
    result.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function safeMtime(p) {
  try { return (await fsp.stat(p)).mtimeMs; } catch { return 0; }
}

/**
 * POST /api/prompts/:promptId/answer - Body { answer }. Writes a
 * sibling .answer.json the runner is polling for. The runner reads
 * it, deletes both files, and resolves askQuestion. An answer of
 * "stop" tells the runner to abort the session.
 */
router.post('/prompts/:promptId/answer', async (req, res) => {
  try {
    const { answer } = req.body || {};
    if (typeof answer !== 'string') {
      return res.status(400).json({ error: 'Body must contain an "answer" string' });
    }
    const dir = promptsDir();
    await fsp.mkdir(dir, { recursive: true });
    const promptPath = path.join(dir, `${req.params.promptId}.json`);
    if (!(await pathExists(promptPath))) {
      return res.status(404).json({ error: `Prompt not found: ${req.params.promptId}` });
    }
    const answerPath = path.join(dir, `${req.params.promptId}.answer.json`);
    await fsp.writeFile(
      answerPath,
      JSON.stringify({ answer, answeredAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/events - Server-Sent Events stream for live board updates.
 *
 * Replaces the old "sync → full page re-render" dance. The chokidar
 * watcher publishes a small event on every sync (plan/session/batch);
 * this endpoint pipes those events to every connected client. The
 * client patches the affected card in place, so scroll position and
 * any open modal survive the update.
 *
 * The connection stays open for the life of the tab. Browsers
 * auto-reconnect on socket drop — we send a keep-alive comment every
 * 25s so intermediate proxies don't kill the idle socket.
 */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable Express compression on this route — SSE must be a raw
    // stream, gzip buffers and breaks the "push on every event" model.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Initial hello so the client knows the stream is open. Useful for
  // the integration test too: the EventSource-equivalent supertest
  // client can wait on the first line.
  res.write('retry: 2000\n');
  res.write('event: hello\ndata: {"ok":true}\n\n');

  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client gone — the close handler will clean up shortly.
    }
  };
  const unsubscribe = subscribeEvents(send);

  // 25s is well under the default 60-90s idle timeout of every sane
  // reverse proxy, but high enough that it doesn't spam the log.
  const keepAlive = setInterval(() => {
    try { res.write(': keep-alive\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end?.();
  });
});

/**
 * GET /api/plans/:planId/log - Tail the detached run's log file.
 *
 * Accepts ?offset=N so a polling UI can request only the new bytes
 * since last read (the "tail -f" UX without SSE). Returns:
 *
 *   { content: string, size: number, exists: boolean }
 *
 * - `exists` is false when the run hasn't started yet (the log path is
 *   deterministic, so we know where to look).
 * - `size` is the current file length; clients pass `offset=size` next
 *   time to get only the delta.
 *
 * Path is the same one that `runPlan` wrote to:
 *   ~/.karajan/hu-board-runs/<planId>.log (honours KJ_HOME in tests).
 */
router.get('/plans/:planId/log', async (req, res) => {
  try {
    const runsDir = getHuBoardRunsDir(); // KJC-TSK-0421
    const logPath = path.join(runsDir, `${req.params.planId}.log`);
    if (!(await pathExists(logPath))) {
      return res.json({ exists: false, size: 0, content: '' });
    }
    const stat = await fsp.stat(logPath);
    const offset = Math.max(0, Math.min(stat.size, Number(req.query.offset) || 0));
    // Cap per-request read to 1 MiB so a huge log can't blow up the
    // response. The client will keep polling and catch up.
    const MAX_READ = 1024 * 1024;
    const length = Math.min(MAX_READ, stat.size - offset);
    let content = '';
    if (length > 0) {
      const fh = await fsp.open(logPath, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, offset);
        content = buf.toString('utf-8');
      } finally {
        await fh.close();
      }
    }
    res.json({ exists: true, size: stat.size, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plans/:planId/run - Launch `kj run --plan <planId>` as a
 * detached child. This is the "Run plan" button's endpoint — the board
 * no longer requires the user to drop to a terminal to kick off the
 * pipeline.
 *
 * Body: { projectId?: string, task?: string } — both optional. projectId
 * makes the plan-file lookup O(1); task overrides plan.task as the
 * pipeline's headline description.
 *
 * Returns the child's pid + the log path so a future "tail this run"
 * viewer can attach.
 */
router.post('/plans/:planId/run', (req, res) => {
  try {
    const { projectId, task, huIds } = req.body || {};
    // PR4: callers may pass `huIds: ["hu_x_001"]` to scope the run
    // to a single HU (or comma-separated subset). When omitted, the
    // whole plan runs as before.
    const result = runPlan({
      planId: req.params.planId,
      projectId,
      taskOverride: task,
      huIds: Array.isArray(huIds) ? huIds : null,
    });
    if (!result.ok) {
      // 404 for "plan not found" (preserves the contract the existing
      // test asserts on), 400 for validation errors (unknown HU id,
      // missing projectDir, etc.).
      const code = /^plan not found/.test(result.error) ? 404 : 400;
      return res.status(code).json({ error: result.error });
    }
    res.json({
      launched: true,
      planId: req.params.planId,
      pid: result.pid,
      logPath: result.logPath,
      huIds: Array.isArray(huIds) && huIds.length > 0 ? huIds : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/hus/:huId/run — PR4: launch a single HU (or, when the
 * caller passes additional ids in body.extraHuIds, a small bundle).
 *
 * The HU's plan is resolved from the SQLite stories table so the
 * front doesn't have to know the planId — it only needs the story
 * id from the card.
 */
router.post('/hus/:huId/run', (req, res) => {
  try {
    const huId = req.params.huId;
    const row = getStoryRow(huId);
    if (!row) return res.status(404).json({ error: `unknown HU: ${huId}` });
    if (!row.plan_id) return res.status(400).json({ error: `HU ${huId} is not backed by a plan (legacy row)` });

    // Story id on disk uses just the HU local id (hu_<plan>_NNN),
    // not the "<projectId>::<huId>" composite the board persists.
    // Strip the prefix back off before forwarding to runPlan.
    const planLocalHuId = huId.includes('::') ? huId.split('::').pop() : huId;
    const extraIds = Array.isArray(req.body?.extraHuIds) ? req.body.extraHuIds.map((x) => (x.includes('::') ? x.split('::').pop() : x)) : [];
    const huIds = [planLocalHuId, ...extraIds];

    // Read the HU title from the plan JSON so kj run receives a
    // meaningful task description instead of the generic plan.task.
    let taskOverride;
    try {
      const planPath = path.join(getHuBoardPlansDir(), row.project_id, `${row.plan_id}.json`);
      const planRaw = fs.readFileSync(planPath, 'utf8');
      const planData = JSON.parse(planRaw);
      const hu = (planData.hus || []).find((h) => h.id === planLocalHuId);
      if (hu?.title) taskOverride = hu.title;
    } catch { /* fall through — runPlan will use plan.task */ }

    const result = runPlan({ planId: row.plan_id, projectId: row.project_id, huIds, taskOverride });
    if (!result.ok) return res.status(400).json({ error: result.error });

    // Move the launched HU(s) to "coding" in BOTH the SQLite mirror and the
    // source-of-truth plan JSON. The plan JSON write is what makes it stick
    // — the next /api/sync re-reads the plan file and would otherwise
    // overwrite the SQLite update back to "certified". Without this the
    // card flashes to Running for ~1s and snaps back, which the user reads
    // as "nothing happened".
    //
    // The orchestrator owns the lifecycle once it boots (it'll move the HU
    // through coding → reviewing → done/failed and persist back to the plan
    // JSON), so this is just the bootstrap nudge to give the user immediate
    // visual feedback.
    const allHuIds = [planLocalHuId, ...extraIds];
    for (const localId of allHuIds) {
      try { setHuStatus({ planId: row.plan_id, huId: localId, status: 'coding', projectId: row.project_id }); } catch { /* non-fatal */ }
      // Also stamp the SQLite row so the next renderBoard() (before any
      // sync tick) shows it in Running.
      const compositeId = localId.includes('::') ? localId : `${row.project_id}::${localId}`;
      try { updateStoryStatus(compositeId, 'coding'); } catch { /* non-fatal */ }
    }

    res.json({
      launched: true,
      planId: row.plan_id,
      huIds,
      pid: result.pid,
      logPath: result.logPath,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:id/run - Sugar: launch every plan of a project. For
 * the common case where each project has exactly one active plan this
 * behaves the same as POST /plans/:planId/run; with multiple plans it
 * kicks each one in its own detached child.
 */
router.post('/projects/:id/run', (req, res) => {
  try {
    const planIds = listPlanIdsForProject(req.params.id);
    if (planIds.length === 0) {
      return res.status(404).json({ error: 'No plan-backed stories for this project' });
    }
    const results = [];
    for (const planId of planIds) {
      const r = runPlan({ planId, projectId: req.params.id });
      results.push({ planId, ...r });
    }
    const launched = results.filter((r) => r.ok).length;
    res.json({ launched, total: planIds.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/config — read the editable subset of the kj.config.yml.
 * Powers the board's settings modal; non-editable keys in the yml are
 * left untouched on PUT (see writeConfigPatch's whitelist semantics).
 *
 * v2.30.0 PR4 — supports `?scope=global|project`:
 *   - `global` (default): reads ~/.karajan/kj.config.yml.
 *   - `project`: reads <projectDir>/.karajan/kj.config.yml.
 * Unknown scopes are 400'd. Response includes the resolved `scope` and
 * `path` so the UI can show which file backs the current view.
 */
router.get('/config', (req, res) => {
  try {
    const scope = req.query?.scope || 'global';
    const data = readConfig({ scope });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/config — apply a patch to the yml. Body is
 * `{ patch: { key: value }, scope?: 'global'|'project' }` with the keys
 * defined in EDITABLE_FIELDS. Unknown keys are 400'd; type errors are
 * 400'd; validation errors are 400'd. Writes are atomic (tmp + rename)
 * and a `.bak` is kept of the previous content.
 *
 * v2.30.0 PR4 — `scope` decides which file is patched. Default 'global'
 * preserves the previous behavior.
 */
router.put('/config', (req, res) => {
  try {
    const patch = req.body?.patch;
    const scope = req.body?.scope || 'global';
    const result = writeConfigPatch(patch, { scope });
    if (!result.written) {
      return res.status(400).json({ error: 'No se pudo guardar la configuración', details: result });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/commands - List the kj commands the board can launch.
 * The UI uses this to render the Actions panel without hardcoding
 * the command list on the client.
 */
router.get('/commands', (_req, res) => {
  res.json({ commands: listSupportedCommands() });
});

/**
 * POST /api/commands/:command - Spawn a kj <command> as a detached
 * child. Body fields depend on the command (see command-runner.js
 * for the per-command input schema). Returns a commandId the client
 * can pass to GET /api/runs/:commandId/log to tail the output.
 *
 * The board never executes free-form arg arrays — the command name
 * must be in the whitelist and each command builds its argv from a
 * typed schema. Anything outside that fails 400.
 */
router.post('/commands/:command', (req, res) => {
  try {
    const result = runKjCommand({ command: req.params.command, input: req.body || {} });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({
      ok: true,
      commandId: result.commandId,
      pid: result.pid,
      logPath: result.logPath,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/runs/:commandId/log - Generalisation of the per-plan log
 * tail. The original `/api/plans/:planId/log` reads
 * `<runsDir>/<planId>.log`; this one reads `<runsDir>/<commandId>.log`
 * where `commandId` is what `/api/commands/:command` returned.
 *
 * Same offset semantics + 1 MiB cap as the plans endpoint.
 */
/**
 * GET /api/runs/:planId/active - Devuelve los runs activos (PIDs vivos)
 * de un plan. Usado por el frontend para decidir si mostrar el botón
 * ⏹ Stop. Respuesta: { active: [{pid, huIds, startedAt}, ...] }.
 *
 * KJC-TSK-0396.
 */
router.get('/runs/:planId/active', (req, res) => {
  try {
    const active = getActiveRuns(req.params.planId);
    res.json({ active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/runs/:planId/stop - Mata todos los procesos del orquestador
 * asociados a este plan. SIGTERM primero, espera 5s, escala a SIGKILL
 * si el proceso no respondió. Devuelve { stopped, killed, errors }.
 *
 * Tras matar el proceso, las HUs que estaban en coding/reviewing se
 * resetean a pending (no a failed) vía hu-zombie-reaper logic — pero
 * eso lo hace el reaper en el siguiente arranque del board. Para
 * efecto inmediato, marcamos aquí las HUs running del plan a pending.
 *
 * KJC-TSK-0396.
 */
router.post('/runs/:planId/stop', async (req, res) => {
  const { planId } = req.params;
  const stopTimeoutMs = Number(req.body?.timeoutMs ?? 5000);
  try {
    const errors = [];
    let stopped = 0;
    let killed = 0;
    const active = getActiveRuns(planId);
    // Fase 1: SIGTERM a todos los procesos trackeados (si los hay).
    for (const run of active) {
      try { process.kill(run.pid, 'SIGTERM'); stopped += 1; }
      catch (err) { errors.push({ pid: run.pid, phase: 'SIGTERM', error: err.message }); }
    }
    // Fase 2: esperar `stopTimeoutMs` y escalar a SIGKILL los que sigan
    // vivos. Saltamos la espera si no había nada que matar.
    if (active.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, stopTimeoutMs));
      const stillAlive = getActiveRuns(planId);
      for (const run of stillAlive) {
        try { process.kill(run.pid, 'SIGKILL'); killed += 1; }
        catch (err) { errors.push({ pid: run.pid, phase: 'SIGKILL', error: err.message }); }
      }
    }
    // Fase 3: SIEMPRE reset de HUs en coding/reviewing del plan → pending.
    // El reset corre aunque no hubiera PIDs trackeados (caso: el run lo
    // lanzaste manualmente desde la terminal, killeaste tú mismo el
    // proceso, pero la DB sigue mostrando HUs en coding y necesitas
    // dejarlas en pending para relanzar limpio).
    let hu_reset_count = 0;
    try {
      const db = getDb();
      const result = db.prepare(
        "UPDATE stories SET status = 'pending', updated_at = ? WHERE plan_id = ? AND status IN ('coding', 'reviewing', 'running')"
      ).run(new Date().toISOString(), planId);
      hu_reset_count = result.changes;
    } catch (err) {
      errors.push({ phase: 'hu_reset', error: err.message });
    }
    const out = { stopped, killed, errors, hu_reset_count };
    if (stopped === 0 && killed === 0 && hu_reset_count === 0) {
      out.message = 'No active runs and no stuck HUs for this plan.';
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:commandId/log', async (req, res) => {
  try {
    const runsDir = getHuBoardRunsDir(); // KJC-TSK-0421
    const logPath = path.join(runsDir, `${req.params.commandId}.log`);
    if (!(await pathExists(logPath))) {
      return res.json({ exists: false, size: 0, content: '' });
    }
    const stat = await fsp.stat(logPath);
    const offset = Math.max(0, Math.min(stat.size, Number(req.query.offset) || 0));
    const MAX_READ = 1024 * 1024;
    const length = Math.min(MAX_READ, stat.size - offset);
    let content = '';
    if (length > 0) {
      const fh = await fsp.open(logPath, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, offset);
        content = buf.toString('utf-8');
      } finally {
        await fh.close();
      }
    }
    res.json({ exists: true, size: stat.size, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/board/restart - Respawn the board server in place. The
 * server can't truly restart itself (it'd kill its own process), so
 * we use the detached-child + parent-exit pattern: spawn a copy with
 * the same argv + cwd + env, unref it, ack the client, then exit
 * after a 250 ms delay so the response actually flushes.
 *
 * The new server overwrites the PID file and bindes the same port
 * (or the next free one if the old one hasn't released yet — handled
 * by the existing find-available-port logic in startBoard).
 *
 * The browser tab's EventSource auto-reconnects, so the user sees a
 * brief blip and the board comes back live.
 */
/**
 * POST /api/board/shutdown - Tell the server to exit cleanly. Used
 * by `kj board stop` as a fallback when the PID file is missing or
 * stale (typical after the user has been hot-pulling Karajan and
 * the running server is from a build that didn't write the PID
 * file). The body of the response is sent before we exit, then a
 * 250 ms delay to let the response flush, then process.exit(0).
 */
router.post('/board/shutdown', (_req, res) => {
  if (process.env.KJ_BOARD_RESTART_MODE === 'echo') {
    return res.json({ ok: true, mode: 'echo' });
  }
  res.json({ ok: true, shuttingDownInMs: 250 });
  setTimeout(() => process.exit(0), 250);
});

router.post('/board/restart', (_req, res) => {
  // Tests / programmatic callers can short-circuit the actual self-
  // exec via env so the suite doesn't have its node process killed
  // mid-test by a misfire.
  if (process.env.KJ_BOARD_RESTART_MODE === 'echo') {
    return res.json({ ok: true, restartingInMs: 0, mode: 'echo' });
  }
  try {
    res.json({ ok: true, restartingInMs: 250 });
    setTimeout(() => {
      try {
        const child = spawnChild(
          process.execPath,
          process.argv.slice(1),
          { cwd: process.cwd(), detached: true, stdio: 'ignore', env: process.env }
        );
        child.unref();
      } catch { /* if respawn fails, the user can `kj board start` manually */ }
      process.exit(0);
    }, 250);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync - Force a full re-scan of hu-stories/ and sessions/ on disk.
 * Useful when chokidar's file watcher misses new subdirectories created after
 * the board started (known limitation with glob patterns).
 */
router.post('/sync', (_req, res) => {
  try {
    fullScan();
    const projects = getProjects();
    res.json({ synced: true, projects: projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rag/query - Semantic search over the indexed RAG corpus
 * (KJC-PCS-0049 Step 8). Body: { text, topK?, scope? }. Response:
 * { hits: [...], empty, topK, scope }. Empty store carries empty=true
 * so the UI can show an actionable hint instead of just empty results.
 */
router.post('/rag/query', async (req, res) => {
  const { text, topK = 5, scope = 'all' } = req.body || {};
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: "'text' is required (non-empty string)" });
  }
  try {
    const { openVecStore, countChunks } = await import('karajan-core/vec-store');
    // KJC-TSK-0632: resolved from karajan-core — the board carries zero
    // relative imports into the CLI src tree (see no-cli-imports test).
    const { makeEmbedder } = await import('karajan-core/rag/embedders/factory');
    const { query } = await import('karajan-core/rag/retriever');
    const db = openVecStore({ dim: 768 });
    try {
      if (countChunks(db) === 0) return res.json({ hits: [], empty: true, topK, scope });
      const embedder = makeEmbedder({});
      const hits = await query(db, embedder, text, { topK: Number(topK), scope });
      res.json({ hits, empty: false, topK, scope });
    } finally { db.close(); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
