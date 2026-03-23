import { Router } from 'express';
import {
  getDashboardStats,
  getProjects,
  getStoriesByProject,
  getStoryDetail,
  getSessionsByProject,
  getSessionDetail,
} from '../db.js';

const router = Router();

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

export default router;
