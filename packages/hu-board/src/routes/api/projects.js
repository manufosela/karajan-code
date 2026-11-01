// KJC-TSK-0541: the project endpoints of /api, composed by routes/api.js.
import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  getProjects,
  deleteProject,
  getKjHome,
  getHuBoardPlansDirs,
  listPlanIdsForProject,
  setProjectIsTest,
  getProjectCost,
  addTombstone,
  getDb,
} from '../../db.js';
import { markPlanReady, renameProject } from '../../plan-mutations.js';
import { runPreflight } from '../../preflight.js';
import { projectPlans } from '../../plans-service.js';

const router = Router();

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
      for await (const plan of projectPlans(projectId)) {
        if (plan?.projectDir) { projectDir = plan.projectDir; break; }
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
    for await (const plan of projectPlans(projectId)) {
      if (plan?.version !== 2) continue;
      out.push({
        planId: plan.planId,
        name: plan.name || (plan.task ? plan.task.slice(0, 80) : plan.planId),
        status: plan.status || 'draft',
        updatedAt: plan.updatedAt || null,
        outcome: plan.outcome || null,
        huCount: Array.isArray(plan.hus) ? plan.hus.length : 0,
        // KJC-TSK-1197: a plan mirroring the shared board says so, with its repo.
        readonly: plan.readonly || null,
        repo: plan.readonly ? plan.repo || null : null,
      });
    }
    res.json({ projectId, plans: out });
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
 * DELETE /api/projects/:id - Cascade delete project + its stories + sessions.
 * Also removes its session and plan directories from disk so the next sync
 * does not re-import them.
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
      ...sessionIds.map((sid) => path.join(getKjHome(), 'sessions', sid)),
      ...getHuBoardPlansDirs().map((root) => path.join(root, id)),
    ];

    const existed = deleteProject(id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });

    // Tombstone the project AND its children so chokidar / fullScan
    // can't bring them back via syncSessionFile / syncPlanFile.
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

export default router;
