// KJC-TSK-1166 (TEAM-GH-E, ADR 0025): the plan that mirrors the shared board is shown, never
// edited from the web: the truth is in the issues, and kj hu move is how it changes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ID = 'home_manu_ws_demo';
const PLAN_ID = 'plan_github-board';
let tmpHome, tmpPlansDir, dbMod, planMutationsMod;

const planPath = () => join(tmpPlansDir, PROJECT_ID, `${PLAN_ID}.json`);
const stamp = '2026-10-24T06:00:00Z';
const plan = () => ({
  planId: PLAN_ID, version: 2, status: 'ready', name: 'github', alias: 'github', readonly: 'github',
  projectDir: '/home/manu/ws/demo', task: 'Shared HU Board: GitHub Issues of acme/app', createdAt: stamp, updatedAt: stamp,
  hus: [{ id: 'HU-7', short_id: 'HU-7', title: 'A', status: 'running', claimed_by: 'jorgecasar', acceptance_criteria: [], createdAt: stamp, updatedAt: stamp }],
});

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'hu-board-mirror-'));
  tmpPlansDir = mkdtempSync(join(tmpdir(), 'hu-board-mirror-plans-'));
  process.env.KJ_HOME = tmpHome;
  process.env.KJ_PLANS_DIR = tmpPlansDir;
  process.env.KJ_RUN_SPAWN_MODE = 'echo';
  mkdirSync(join(tmpPlansDir, PROJECT_ID), { recursive: true });
  writeFileSync(planPath(), JSON.stringify(plan(), null, 2), 'utf-8');
  dbMod = await import('../src/db.js');
  planMutationsMod = await import('../src/plan-mutations.js');
  dbMod.initDb();
});
afterEach(() => {
  dbMod.closeDb();
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpPlansDir, { recursive: true, force: true });
});

describe('a plan that mirrors the shared board', () => {
  it('refuses every mutation from the web and leaves the file as it was', () => {
    const args = { planId: PLAN_ID, huId: 'HU-7', projectId: PROJECT_ID };
    const attempts = [
      planMutationsMod.setHuStatus({ ...args, status: 'done' }),
      planMutationsMod.setHuFields({ ...args, patch: { title: 'B' } }),
      planMutationsMod.setHuFailResult({ ...args, blocker: 'x' }),
      planMutationsMod.markPlanReady({ planId: PLAN_ID, projectId: PROJECT_ID }),
    ];
    for (const r of attempts) expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/mirrors the shared board.*kj hu move/) });
    expect(JSON.parse(readFileSync(planPath(), 'utf-8'))).toEqual(plan());
  });

  it('is skipped by a project rename, which goes on with the writable plans', () => {
    const local = join(tmpPlansDir, PROJECT_ID, 'plan-local.json');
    writeFileSync(local, JSON.stringify({ ...plan(), planId: 'plan-local', alias: 'local', name: 'old', readonly: undefined }, null, 2), 'utf-8');
    expect(planMutationsMod.renameProject({ projectId: PROJECT_ID, name: 'New name' })).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(local, 'utf-8')).name).toBe('New name');
    expect(JSON.parse(readFileSync(planPath(), 'utf-8')).name).toBe('github');
  });

  it('KJC-TSK-1197: is announced by the plans endpoint with its repo, so the board can explain it', async () => {
    writeFileSync(planPath(), JSON.stringify({ ...plan(), repo: 'acme/app' }, null, 2), 'utf-8');
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { default: apiRoutes } = await import('../src/routes/api.js');
    const app = express().use('/api', apiRoutes);
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/plans-outcome`);
    expect(res.body.plans).toEqual([expect.objectContaining({ planId: PLAN_ID, readonly: 'github', repo: 'acme/app' })]);
  });
});
