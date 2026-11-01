// KJC-TSK-0541: the session endpoints of /api, composed by routes/api.js.
import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  getProjects,
  getSessionsByProject,
  getSessionDetail,
  deleteSession,
  getKjHome,
  addTombstone,
} from '../../db.js';

const router = Router();

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

export default router;
