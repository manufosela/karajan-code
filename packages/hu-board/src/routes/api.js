import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDashboardStats,
  getProjects,
  getStoriesByProject,
  getStoryDetail,
  getSessionsByProject,
  getSessionDetail,
  deleteProject,
  deleteStory,
  deleteSession,
  getKjHome,
  getStoryRow,
  listPlanIdsForProject,
} from '../db.js';
import { fullScan } from '../sync.js';
import { setHuStatus, setHuFields, markPlanReady, runPlan } from '../plan-mutations.js';

const router = Router();

/**
 * Resolve the hu-stories dir where batch.json files live.
 */
function huStoriesDir() {
  return path.join(getKjHome(), 'hu-stories');
}

/**
 * Best-effort removal of the hu-stories/<id>/ directory.
 */
function removeBatchDir(batchId) {
  try {
    const dir = path.join(huStoriesDir(), batchId);
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
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
router.delete('/projects/:id', (req, res) => {
  try {
    const existed = deleteProject(req.params.id);
    if (!existed) return res.status(404).json({ error: 'Project not found' });
    const dirRemoved = removeBatchDir(req.params.id);
    res.json({ deleted: true, dirRemoved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/stories/:id - Delete a single story from DB.
 * The underlying batch.json is not mutated (story survives on disk and will
 * be re-imported on next sync). This endpoint is a DB-only soft hide.
 */
router.delete('/stories/:id', (req, res) => {
  try {
    const ok = deleteStory(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Story not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/sessions/:id - Delete a single session from DB.
 */
router.delete('/sessions/:id', (req, res) => {
  try {
    const ok = deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Session not found' });
    res.json({ deleted: true });
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
const ALLOWED_STORY_STATUSES = new Set(['pending', 'certified', 'done', 'needs_context']);
const EDITABLE_HU_FIELDS = ['title', 'scope', 'task_type', 'acceptance_criteria', 'acceptance_tests', 'blocked_by'];

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
      return res.status(400).json({
        error: `status must be one of: ${[...ALLOWED_STORY_STATUSES].join(', ')}`,
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
      if (!fieldResult.ok) return res.status(404).json({ error: fieldResult.error });
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
    const { projectId, task } = req.body || {};
    const result = runPlan({ planId: req.params.planId, projectId, taskOverride: task });
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({
      launched: true,
      planId: req.params.planId,
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

export default router;
