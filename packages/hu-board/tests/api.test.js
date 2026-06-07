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

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/is-test  (KJC-TSK-0371 — board polish #3)
//
// The endpoint exists so the user can override the default ephemeral-
// cleanup heuristic per-project: keep something the heuristic would
// delete (`is_test=0`) or force-delete something it wouldn't
// (`is_test=1`). The handler accepts ONLY the three legal sentinels
// (0, 1, null) — anything else is a 400.
// ---------------------------------------------------------------------------
describe('PATCH /api/projects/:id/is-test', () => {
  it('accepts is_test=1 and persists it', async () => {
    seed();
    const res = await request(app)
      .patch('/api/projects/proj-1/is-test')
      .send({ is_test: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, project_id: 'proj-1', is_test: 1 });
    const projects = dbMod.getProjects();
    expect(projects.find((p) => p.id === 'proj-1').is_test).toBe(1);
  });

  it('accepts is_test=0 (preserve override) and persists it', async () => {
    const res = await request(app)
      .patch('/api/projects/proj-1/is-test')
      .send({ is_test: 0 });
    expect(res.status).toBe(200);
    expect(res.body.is_test).toBe(0);
    expect(dbMod.getProjects().find((p) => p.id === 'proj-1').is_test).toBe(0);
  });

  it('accepts is_test=null (revert to default heuristic)', async () => {
    const res = await request(app)
      .patch('/api/projects/proj-1/is-test')
      .send({ is_test: null });
    expect(res.status).toBe(200);
    expect(res.body.is_test).toBeNull();
    expect(dbMod.getProjects().find((p) => p.id === 'proj-1').is_test).toBeNull();
  });

  it('returns 400 for an invalid is_test value', async () => {
    const res = await request(app)
      .patch('/api/projects/proj-1/is-test')
      .send({ is_test: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be 0, 1, or null/);
  });

  it('returns 400 when is_test key is missing', async () => {
    const res = await request(app)
      .patch('/api/projects/proj-1/is-test')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown project', async () => {
    const res = await request(app)
      .patch('/api/projects/no-such-id/is-test')
      .send({ is_test: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/stories/:id — KJC-TSK-0394 PR6 (AC 6).
//
// El endpoint sólo acepta el modelo canónico {pending, running, done}.
// Status legacy (`certified`, `failed`, `coding`, `reviewing`, `blocked`,
// `needs_context`) devuelven 400 con `suggestion` apuntando al mapping
// canónico {status, result} — herramientas externas pueden leerlo,
// aplicar el mapeo, y re-intentar sin descubrir la tabla por ensayo.
// Status desconocido también devuelve 400, con `suggestion: null`.
// ---------------------------------------------------------------------------
describe('PATCH /api/stories/:id — canonical status guard (KJC-TSK-0394 AC 6)', () => {
  it('returns 400 + suggestion when status is legacy "certified"', async () => {
    seed();
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'certified' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
    expect(res.body.suggestion).toEqual({ status: 'done', result: 'pass' });
  });

  it('returns 400 + suggestion when status is legacy "failed"', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'failed' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toEqual({ status: 'pending', result: 'fail' });
  });

  it('returns 400 + suggestion when status is legacy "coding"', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'coding' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toEqual({ status: 'running', result: null });
  });

  it('returns 400 + suggestion when status is legacy "reviewing"', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'reviewing' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toEqual({ status: 'running', result: null });
  });

  it('returns 400 + suggestion when status is legacy "blocked"', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'blocked' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toEqual({ status: 'pending', result: null });
  });

  it('returns 400 + suggestion when status is legacy "needs_context"', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'needs_context' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toEqual({ status: 'pending', result: null });
  });

  it('returns 400 + suggestion:null when status is unknown', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({ status: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.suggestion).toBeNull();
  });

  it('returns 400 when body has neither status nor editable field', async () => {
    const res = await request(app)
      .patch('/api/stories/story-1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Body must include status/);
  });
});

// KJC-TSK-0414 PR4
describe('GET /api/standby', () => {
  it('lista vacía cuando no hay sesiones hibernadas', async () => {
    const res = await request(app).get('/api/standby');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });

  it('devuelve las sesiones persistidas', async () => {
    const { persistStandby } = await import('@karajan/core/standby-store');
    persistStandby({
      sessionId: 'test-s1',
      cooldownUntil: '2099-01-01T00:00:00Z',
      reason: 'QUOTA_EXHAUSTED_DAILY',
      planId: 'p1',
      huId: 'hu_001',
    });
    const res = await request(app).get('/api/standby');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].sessionId).toBe('test-s1');
    expect(res.body.sessions[0].planId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/cost (KJC-TSK-0516, Cost E)
// ---------------------------------------------------------------------------
describe('GET /api/projects/:id/cost', () => {
  it('aggregates totalUsd and groups by plan_id', async () => {
    dbMod.upsertProject({ id: 'proj-cost', name: 'Cost Project' });
    dbMod.upsertStory({ id: 'st-c1', project_id: 'proj-cost', plan_id: 'plan-A' });
    dbMod.upsertStory({ id: 'st-c2', project_id: 'proj-cost', plan_id: 'plan-A' });
    dbMod.upsertStory({ id: 'st-c3', project_id: 'proj-cost', plan_id: 'plan-B' });
    dbMod.setStoryCost('st-c1', 1.25);
    dbMod.setStoryCost('st-c2', 0.75);
    dbMod.setStoryCost('st-c3', 0.5);

    const res = await request(app).get('/api/projects/proj-cost/cost');
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.totalUsd).toBe(2.5);
    expect(res.body.byPlan).toHaveLength(2);
    // sorted by totalUsd desc → plan-A (2.0) before plan-B (0.5)
    expect(res.body.byPlan[0]).toEqual({ planId: 'plan-A', totalUsd: 2, huCount: 2 });
    expect(res.body.byPlan[1]).toEqual({ planId: 'plan-B', totalUsd: 0.5, huCount: 1 });
    expect(res.body.unknownModelTokens).toEqual({ tokensIn: 0, tokensOut: 0, models: [] });
  });

  it('returns totalUsd=0 and empty byPlan when no story has cost', async () => {
    dbMod.upsertProject({ id: 'proj-cost-empty', name: 'Empty' });
    dbMod.upsertStory({ id: 'st-e1', project_id: 'proj-cost-empty', plan_id: 'plan-X' });

    const res = await request(app).get('/api/projects/proj-cost-empty/cost');
    expect(res.status).toBe(200);
    expect(res.body.totalUsd).toBe(0);
    expect(res.body.byPlan).toEqual([]);
  });

  it('groups stories with NULL plan_id under "unassigned"', async () => {
    dbMod.upsertProject({ id: 'proj-cost-na', name: 'NoPlan' });
    dbMod.upsertStory({ id: 'st-na1', project_id: 'proj-cost-na' });
    dbMod.setStoryCost('st-na1', 0.1);

    const res = await request(app).get('/api/projects/proj-cost-na/cost');
    expect(res.status).toBe(200);
    expect(res.body.byPlan[0].planId).toBe('unassigned');
    expect(res.body.byPlan[0].huCount).toBe(1);
  });

  it('returns 404 for unknown project', async () => {
    const res = await request(app).get('/api/projects/nonexistent/cost');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
