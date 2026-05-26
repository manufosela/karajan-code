import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { addHu, updateHu } from '../../../src/plan/plan-hu-ops.js';
import { createPlanV2 } from '../../../src/plan/plan-schema.js';

// KJC-PRP-0002 PR6: per-HU `assignee` field (team-shared boards). Stored
// unconditionally; UI gates visibility on project.is_shared. Covers the
// chain plan-hu-ops → sync.js → PATCH /api/stories/:id.

describe('PR6 plan-hu-ops accepts assignee', () => {
  it('addHu defaults to null and stores provided value verbatim', () => {
    const p = createPlanV2('t');
    expect(addHu(p, { title: 'h1' }).assignee).toBeNull();
    expect(addHu(p, { title: 'h2', assignee: '@manufosela' }).assignee).toBe('@manufosela');
  });

  it('updateHu sets and clears assignee', () => {
    const p = createPlanV2('t');
    const hu = addHu(p, { title: 'h1' });
    expect(updateHu(p, hu.id, { assignee: 'dev_016' }).assignee).toBe('dev_016');
    expect(updateHu(p, hu.id, { assignee: null }).assignee).toBeNull();
  });
});

describe('PR6 sync + API end-to-end', () => {
  const PROJECT_ID = 'home_manu_ws_ai_pr6-demo';
  const PLAN_ID = 'plan-20260526010101-pr6x';
  let tmpHome, tmpPlansDir, app, dbMod, syncMod;
  const planPath = () => join(tmpPlansDir, PROJECT_ID, `${PLAN_ID}.json`);

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'hu-board-pr6-'));
    tmpPlansDir = mkdtempSync(join(tmpdir(), 'hu-board-plans-pr6-'));
    process.env.KJ_HOME = tmpHome;
    process.env.KJ_PLANS_DIR = tmpPlansDir;
    process.env.KJ_RUN_SPAWN_MODE = 'echo';

    dbMod = await import('../src/db.js');
    syncMod = await import('../src/sync.js');
    const { default: apiRoutes } = await import('../src/routes/api.js');
    dbMod.initDb();
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);

    mkdirSync(join(tmpPlansDir, PROJECT_ID), { recursive: true });
    const plan = createPlanV2('build thing');
    plan.planId = PLAN_ID;
    plan.projectDir = '/home/manu/ws/ai/pr6-demo';
    addHu(plan, { title: 'hu uno', assignee: '@manufosela' });
    writeFileSync(planPath(), JSON.stringify(plan, null, 2), 'utf-8');
    syncMod.syncPlanFile(planPath());
  });

  afterEach(() => {
    delete process.env.KJ_RUN_SPAWN_MODE;
    dbMod.closeDb();
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpPlansDir, { recursive: true, force: true });
    delete process.env.KJ_HOME;
    delete process.env.KJ_PLANS_DIR;
  });

  it('syncPlanFile propagates assignee from plan JSON to the stories row', async () => {
    const res = await request(app).get(`/api/projects/${encodeURIComponent(PROJECT_ID)}/stories`);
    expect(res.status).toBe(200);
    expect(res.body.find((s) => s.id.endsWith(`${PLAN_ID}_001`)).assignee).toBe('@manufosela');
  });

  it('PATCH /api/stories/:id with {assignee} writes the new value, null clears it', async () => {
    const huId = JSON.parse(readFileSync(planPath(), 'utf-8')).hus[0].id;
    const storyId = `${PROJECT_ID}::${huId}`;

    const setRes = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`).send({ assignee: 'dev_016' });
    expect(setRes.status).toBe(200);
    expect(JSON.parse(readFileSync(planPath(), 'utf-8')).hus[0].assignee).toBe('dev_016');

    const clearRes = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`).send({ assignee: null });
    expect(clearRes.status).toBe(200);
    expect(JSON.parse(readFileSync(planPath(), 'utf-8')).hus[0].assignee).toBeNull();
  });
});
