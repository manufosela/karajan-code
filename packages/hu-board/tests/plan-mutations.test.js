import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// Tests for the new write endpoints that back the HU Board's "Certify" /
// "Mark ready" buttons:
//   - PATCH  /api/stories/:id
//   - POST   /api/plans/:planId/ready
//   - POST   /api/projects/:id/ready
//
// Every mutation must update the plan JSON on disk FIRST, then re-sync the
// SQLite row — otherwise a page reload would silently revert the change.
// Each test reloads the plan file to assert that the disk reflects the
// ack'd state (not just the cache).

let tmpHome;
let tmpPlansDir;
let app;
let dbMod;
let planMutationsMod;
let syncMod;

const PROJECT_ID = 'home_manu_ws_ai_demo-project';
const PLAN_ID = 'plan-20260424101010-abcd';

function planPath() {
  return join(tmpPlansDir, PROJECT_ID, `${PLAN_ID}.json`);
}

function writePlanToDisk(overrides = {}) {
  mkdirSync(join(tmpPlansDir, PROJECT_ID), { recursive: true });
  const plan = {
    planId: PLAN_ID,
    version: 2,
    status: 'draft',
    projectDir: '/home/manu/ws/ai/demo-project',
    task: 'build thing',
    name: 'demo plan',
    createdAt: '2026-04-24T10:10:10Z',
    updatedAt: '2026-04-24T10:10:10Z',
    hus: [
      { id: `${PLAN_ID}_001`, title: 'hu one', status: 'pending', acceptance_criteria: [], createdAt: '2026-04-24T10:10:10Z', updatedAt: '2026-04-24T10:10:10Z' },
      { id: `${PLAN_ID}_002`, title: 'hu two', status: 'pending', acceptance_criteria: [], createdAt: '2026-04-24T10:10:10Z', updatedAt: '2026-04-24T10:10:10Z' },
      { id: `${PLAN_ID}_003`, title: 'hu three', status: 'pending', acceptance_criteria: [], createdAt: '2026-04-24T10:10:10Z', updatedAt: '2026-04-24T10:10:10Z' },
    ],
    ...overrides,
  };
  writeFileSync(planPath(), JSON.stringify(plan, null, 2), 'utf-8');
  return plan;
}

function readPlanFromDisk() {
  return JSON.parse(readFileSync(planPath(), 'utf-8'));
}

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'hu-board-mut-'));
  tmpPlansDir = mkdtempSync(join(tmpdir(), 'hu-board-plans-'));
  process.env.KJ_HOME = tmpHome;
  process.env.KJ_PLANS_DIR = tmpPlansDir;

  // Modules are imported once across the suite; `initDb()` swaps the
  // underlying SQLite handle to one rooted in the per-test tmpHome, and
  // `closeDb()` in afterEach tears it down — so each test gets a clean
  // board + plans root without the cache-busting import tricks vitest
  // refuses to evaluate.
  dbMod = await import('../src/db.js');
  planMutationsMod = await import('../src/plan-mutations.js');
  syncMod = await import('../src/sync.js');
  const { default: apiRoutes } = await import('../src/routes/api.js');

  dbMod.initDb();

  app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  // Seed: write plan → sync → board sees 3 pending HUs.
  writePlanToDisk();
  syncMod.syncPlanFile(planPath());
});

afterEach(() => {
  dbMod.closeDb();
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpPlansDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

describe('PATCH /api/stories/:id', () => {
  it('certifies a pending HU and writes the new status to the plan JSON', async () => {
    const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ status: 'certified' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('certified');

    const diskPlan = readPlanFromDisk();
    const hu = diskPlan.hus.find((h) => h.id === `${PLAN_ID}_001`);
    expect(hu.status).toBe('certified');
  });

  it('auto-advances plan.status to ready when every HU ends up certified', async () => {
    for (const n of ['001', '002', '003']) {
      await request(app)
        .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_${n}`)}`)
        .send({ status: 'certified' });
    }
    const diskPlan = readPlanFromDisk();
    expect(diskPlan.status).toBe('ready');
  });

  it('rolls plan.status back to draft when a certified HU is downgraded', async () => {
    // First make the plan ready...
    for (const n of ['001', '002', '003']) {
      await request(app)
        .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_${n}`)}`)
        .send({ status: 'certified' });
    }
    expect(readPlanFromDisk().status).toBe('ready');
    // ...then uncertify one.
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_002`)}`)
      .send({ status: 'pending' });
    expect(res.status).toBe(200);
    expect(readPlanFromDisk().status).toBe('draft');
  });

  it('rejects an unknown status with 400 and does not touch disk', async () => {
    const before = JSON.stringify(readPlanFromDisk());
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_001`)}`)
      .send({ status: 'reticulating-splines' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(readPlanFromDisk())).toBe(before);
  });

  it('returns 404 for an unknown story id', async () => {
    const res = await request(app)
      .patch('/api/stories/nope')
      .send({ status: 'certified' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/plans/:planId/ready', () => {
  it('certifies every pending HU and flips the plan to ready', async () => {
    const res = await request(app)
      .post(`/api/plans/${PLAN_ID}/ready`)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.planStatus).toBe('ready');

    const diskPlan = readPlanFromDisk();
    expect(diskPlan.status).toBe('ready');
    expect(diskPlan.hus.every((h) => h.status === 'certified')).toBe(true);
  });

  it('works without a projectId hint by falling back to a plans-dir scan', async () => {
    const res = await request(app).post(`/api/plans/${PLAN_ID}/ready`).send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it('returns 404 for an unknown planId', async () => {
    const res = await request(app).post('/api/plans/plan-ghost/ready').send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/:id/ready', () => {
  it('bulk-certifies every plan of a project', async () => {
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent(PROJECT_ID)}/ready`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.totalCertified).toBe(3);
    expect(readPlanFromDisk().status).toBe('ready');
  });

  it('returns 404 when the project has no plan-backed stories', async () => {
    dbMod.upsertProject({ id: 'bare-project', name: 'Bare' });
    dbMod.upsertStory({ id: 'bare-project::hu-x', project_id: 'bare-project', status: 'pending' });
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent('bare-project')}/ready`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('plan_id stamping via syncPlanFile', () => {
  it('persists plan_id on every story row so PATCH can find the file', () => {
    const row = dbMod.getStoryRow(`${PROJECT_ID}::${PLAN_ID}_001`);
    expect(row).not.toBeNull();
    expect(row.plan_id).toBe(PLAN_ID);
    expect(row.project_id).toBe(PROJECT_ID);
  });

  it('listPlanIdsForProject returns distinct plan ids', () => {
    const ids = dbMod.listPlanIdsForProject(PROJECT_ID);
    expect(ids).toEqual([PLAN_ID]);
  });
});
