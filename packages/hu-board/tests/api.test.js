import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let tmpDir;
let app;
let dbMod;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-api-'));
  process.env.KJ_HOME = tmpDir;

  dbMod = await import('../src/db.js');
  dbMod.initDb();

  // Build a minimal Express app with the API routes
  const { default: apiRoutes } = await import('../src/routes/api.js');
  app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
});

afterAll(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

// Seed helper
function seed() {
  dbMod.upsertProject({ id: 'proj-1', name: 'Project One' });
  dbMod.upsertProject({ id: 'proj-2', name: 'Project Two' });
  dbMod.upsertStory({ id: 'story-1', project_id: 'proj-1', status: 'certified', quality_total: 90 });
  dbMod.upsertStory({ id: 'story-2', project_id: 'proj-1', status: 'pending' });
  dbMod.upsertStory({ id: 'story-3', project_id: 'proj-2', status: 'done' });
  dbMod.upsertSession({
    id: 'sess-1',
    project_id: 'proj-1',
    task: 'Build login',
    status: 'approved',
    approved: true,
    iterations: 3,
    commits: JSON.stringify([{ hash: 'abc', message: 'feat: login' }]),
    stages_completed: JSON.stringify(['coder', 'reviewer']),
    checkpoints: JSON.stringify([{ iteration: 1, stage: 'coder' }]),
  });
  dbMod.upsertSession({ id: 'sess-2', project_id: 'proj-2', task: 'Add tests', status: 'failed', approved: false });
}

// ---------------------------------------------------------------------------
// GET /api/dashboard
// ---------------------------------------------------------------------------
describe('GET /api/dashboard', () => {
  it('returns stats object with expected keys', async () => {
    seed();
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_stories');
    expect(res.body).toHaveProperty('certified_stories');
    expect(res.body).toHaveProperty('pending_stories');
    expect(res.body).toHaveProperty('done_stories');
    expect(res.body).toHaveProperty('needs_context_stories');
    expect(res.body).toHaveProperty('avg_quality');
    expect(res.body).toHaveProperty('total_sessions');
    expect(res.body).toHaveProperty('approved_sessions');
    expect(res.body).toHaveProperty('total_projects');
    expect(typeof res.body.total_stories).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
describe('GET /api/projects', () => {
  it('returns an array of projects', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------
describe('GET /api/projects/:id', () => {
  it('returns a project when it exists', async () => {
    const res = await request(app).get('/api/projects/proj-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('proj-1');
    expect(res.body.name).toBe('Project One');
    expect(res.body).toHaveProperty('story_count');
  });

  it('returns 404 for unknown project', async () => {
    const res = await request(app).get('/api/projects/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/stories
// ---------------------------------------------------------------------------
describe('GET /api/projects/:id/stories', () => {
  it('returns stories for a known project', async () => {
    const res = await request(app).get('/api/projects/proj-1/stories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.every((s) => s.project_id === 'proj-1')).toBe(true);
  });

  it('returns empty array for unknown project', async () => {
    const res = await request(app).get('/api/projects/nonexistent/stories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stories/:id
// ---------------------------------------------------------------------------
describe('GET /api/stories/:id', () => {
  it('returns story detail with context_requests', async () => {
    const res = await request(app).get('/api/stories/story-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('story-1');
    expect(res.body).toHaveProperty('context_requests');
    expect(Array.isArray(res.body.context_requests)).toBe(true);
  });

  it('returns 404 for unknown story', async () => {
    const res = await request(app).get('/api/stories/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/sessions
// ---------------------------------------------------------------------------
describe('GET /api/projects/:id/sessions', () => {
  it('returns sessions for a known project', async () => {
    const res = await request(app).get('/api/projects/proj-1/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((s) => s.project_id === 'proj-1')).toBe(true);
  });

  it('returns empty array for unknown project', async () => {
    const res = await request(app).get('/api/projects/nonexistent/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id
// ---------------------------------------------------------------------------
describe('GET /api/sessions/:id', () => {
  it('returns session detail with parsed JSON fields', async () => {
    const res = await request(app).get('/api/sessions/sess-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sess-1');
    expect(res.body.task).toBe('Build login');
    // JSON fields should be parsed into objects/arrays
    expect(Array.isArray(res.body.commits)).toBe(true);
    expect(res.body.commits[0].hash).toBe('abc');
    expect(Array.isArray(res.body.stages_completed)).toBe(true);
    expect(Array.isArray(res.body.checkpoints)).toBe(true);
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions (all sessions)
// ---------------------------------------------------------------------------
describe('GET /api/sessions', () => {
  it('returns all sessions across projects', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Should be sorted by created_at desc
    const ids = res.body.map((s) => s.id);
    expect(ids).toContain('sess-1');
    expect(ids).toContain('sess-2');
  });
});
