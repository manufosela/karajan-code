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
  // Don't actually spawn the orchestrator — "echo" mode short-circuits
  // runPlan so we can assert the payload shape without booting kj run
  // inside vitest.
  process.env.KJ_RUN_SPAWN_MODE = 'echo';

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
  delete process.env.KJ_RUN_SPAWN_MODE;
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

  // KJC-TSK-0394 step 2: el botón "↺ Reset" del modal envía
  // PATCH {status: 'pending'} desde cualquier estado no terminal
  // o terminal. La API ya aceptaba 'pending' en ALLOWED_STORY_STATUSES,
  // pero conviene asegurar que el reset SOBREVIVE al ciclo escritura→
  // sync de plan-mutations y NO toca el campo `result` (historial).
  it('reset desde "coding" zombi a "pending" reescribe el plan', async () => {
    // Simulamos el zombi: el orquestador empezó la HU y murió antes de
    // estampar outcome. El plan-on-disk tiene status=coding.
    const plan = readPlanFromDisk();
    plan.hus[0].status = 'coding';
    plan.hus[0].result = 'fail';
    writeFileSync(planPath(), JSON.stringify(plan, null, 2), 'utf-8');
    syncMod.syncPlanFile(planPath());

    const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ status: 'pending' });

    expect(res.status).toBe(200);
    const hu = readPlanFromDisk().hus.find((h) => h.id === `${PLAN_ID}_001`);
    expect(hu.status).toBe('pending');
    // result se preserva como historial
    expect(hu.result).toBe('fail');
  });

  // KJC-TSK-0403: 'failed' eliminado del dropdown — el orquestador
  // estampa result=fail dejando status=pending. Setearlo a mano ya no
  // tiene sentido. Set permitido: pending/certified/done/blocked/needs_context.
  it.each(['certified', 'done', 'blocked', 'needs_context'])(
    'PATCH stories acepta cambiar a "%s" manualmente',
    async (target) => {
      const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;
      const res = await request(app)
        .patch(`/api/stories/${encodeURIComponent(storyId)}`)
        .send({ status: target });
      expect(res.status).toBe(200);
      const hu = readPlanFromDisk().hus.find((h) => h.id === `${PLAN_ID}_001`);
      expect(hu.status).toBe(target);
    },
  );

  // KJC-TSK-0403: 'failed' explícitamente RECHAZADO.
  it('PATCH stories RECHAZA status="failed" con 400 (KJC-TSK-0403)', async () => {
    const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ status: 'failed' });
    expect(res.status).toBe(400);
  });

  // NO se permite settear lifecycle del orquestador (genera zombies).
  it.each(['coding', 'reviewing', 'running'])(
    'PATCH stories RECHAZA status del orquestador "%s" con 400',
    async (target) => {
      const res = await request(app)
        .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_001`)}`)
        .send({ status: target });
      expect(res.status).toBe(400);
    },
  );

  it('reset desde "done" a "pending" preserva el result anterior', async () => {
    const plan = readPlanFromDisk();
    plan.hus[0].status = 'done';
    plan.hus[0].result = 'pass';
    writeFileSync(planPath(), JSON.stringify(plan, null, 2), 'utf-8');
    syncMod.syncPlanFile(planPath());

    const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ status: 'pending' });

    expect(res.status).toBe(200);
    const hu = readPlanFromDisk().hus.find((h) => h.id === `${PLAN_ID}_001`);
    expect(hu.status).toBe('pending');
    expect(hu.result).toBe('pass');
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

describe('denormalised ac_count / test_count / blocked_by on story rows', () => {
  it('stamps ac_count and test_count from the plan JSON', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_010`,
          title: 'rich hu',
          status: 'pending',
          acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }, 'another'],
          acceptance_tests: ['t1', 't2', 't3'],
          blocked_by: [],
          createdAt: '2026-04-24T10:10:10Z',
          updatedAt: '2026-04-24T10:10:10Z',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const stories = dbMod.getStoriesByProject(PROJECT_ID);
    const row = stories.find((s) => s.id.endsWith('_010'));
    expect(row.ac_count).toBe(2);
    expect(row.test_count).toBe(3);
  });

  it('stamps blocked_by as a JSON array of HU ids', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_100`,
          title: 'root',
          status: 'pending',
          acceptance_criteria: [],
          blocked_by: [],
          createdAt: '2026-04-24T10:10:10Z', updatedAt: '2026-04-24T10:10:10Z',
        },
        {
          id: `${PLAN_ID}_200`,
          title: 'child',
          status: 'pending',
          acceptance_criteria: [],
          blocked_by: [`${PLAN_ID}_100`],
          createdAt: '2026-04-24T10:10:10Z', updatedAt: '2026-04-24T10:10:10Z',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const stories = dbMod.getStoriesByProject(PROJECT_ID);
    const child = stories.find((s) => s.id.endsWith('_200'));
    expect(JSON.parse(child.blocked_by)).toEqual([`${PLAN_ID}_100`]);
    const root = stories.find((s) => s.id.endsWith('_100'));
    expect(root.blocked_by).toBeNull();
  });
});

describe('PATCH /api/stories/:id - field edits (title, scope, task_type, acceptance_criteria)', () => {
  const storyId = `${PROJECT_ID}::${PLAN_ID}_001`;

  it('edits the title and persists to the plan JSON', async () => {
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ title: 'renamed via board' });
    expect(res.status).toBe(200);
    expect(res.body.hu.title).toBe('renamed via board');
    const plan = readPlanFromDisk();
    expect(plan.hus.find((h) => h.id === `${PLAN_ID}_001`).title).toBe('renamed via board');
  });

  it('edits the scope', async () => {
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ scope: 'new scope here' });
    expect(res.status).toBe(200);
    expect(readPlanFromDisk().hus[0].scope).toBe('new scope here');
  });

  it('changes task_type', async () => {
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ task_type: 'refactor' });
    expect(res.status).toBe(200);
    expect(readPlanFromDisk().hus[0].task_type).toBe('refactor');
  });

  it('rewrites acceptance_criteria as a list of strings or Gherkin objects', async () => {
    const newAc = [
      'raw string criterion',
      { given: 'user logs in', when: 'they visit /', then: 'dashboard is shown' },
    ];
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ acceptance_criteria: newAc });
    expect(res.status).toBe(200);
    expect(readPlanFromDisk().hus[0].acceptance_criteria).toEqual(newAc);
  });

  it('allows combining a status change with field edits in one PATCH', async () => {
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ title: 'combined edit', status: 'certified' });
    expect(res.status).toBe(200);
    const plan = readPlanFromDisk();
    const hu = plan.hus.find((h) => h.id === `${PLAN_ID}_001`);
    expect(hu.title).toBe('combined edit');
    expect(hu.status).toBe('certified');
  });

  it('ignores unknown fields', async () => {
    const before = JSON.stringify(readPlanFromDisk());
    const res = await request(app)
      .patch(`/api/stories/${encodeURIComponent(storyId)}`)
      .send({ irrelevant: 'x' });
    // No status + no whitelisted field → 400.
    expect(res.status).toBe(400);
    expect(JSON.stringify(readPlanFromDisk())).toBe(before);
  });
});

describe('POST /api/plans/:planId/run', () => {
  it('returns the pid + log path + resolved argv in echo mode', async () => {
    const res = await request(app)
      .post(`/api/plans/${PLAN_ID}/run`)
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    expect(res.body.launched).toBe(true);
    expect(res.body.planId).toBe(PLAN_ID);
    expect(res.body.logPath).toMatch(/hu-board-runs\/.+\.log$/);
  });

  it('respects taskOverride when provided', () => {
    const result = planMutationsMod.runPlan({
      planId: PLAN_ID,
      projectId: PROJECT_ID,
      taskOverride: 'custom goal here',
    });
    expect(result.ok).toBe(true);
    expect(result.argv[result.argv.length - 1]).toBe('custom goal here');
  });

  it('returns 404 for an unknown plan', async () => {
    const res = await request(app).post('/api/plans/plan-nope/run').send({});
    expect(res.status).toBe(404);
  });

  it('refuses to run plans without projectDir (legacy pre-v2.7.4)', () => {
    // Strip projectDir from the existing plan and rewrite it.
    writePlanToDisk({ projectDir: undefined });
    const result = planMutationsMod.runPlan({ planId: PLAN_ID, projectId: PROJECT_ID });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/projectDir/);
  });
});

// KJC-TSK-0396: endpoints de Stop + active runs.
describe('POST /api/runs/:planId/stop + GET /api/runs/:planId/active', () => {
  let trackerMod;
  beforeEach(async () => {
    trackerMod = await import('../src/run-tracker.js');
    trackerMod._resetForTests();
  });

  it('GET /active devuelve [] cuando no hay runs', async () => {
    const res = await request(app).get(`/api/runs/${PLAN_ID}/active`);
    expect(res.status).toBe(200);
    expect(res.body.active).toEqual([]);
  });

  it('GET /active devuelve los runs vivos tracked', async () => {
    trackerMod.trackRun(PLAN_ID, { pid: process.pid });
    const res = await request(app).get(`/api/runs/${PLAN_ID}/active`);
    expect(res.status).toBe(200);
    expect(res.body.active).toHaveLength(1);
    expect(res.body.active[0].pid).toBe(process.pid);
  });

  it('POST /stop sin runs activos ni HUs zombi responde 200 con mensaje', async () => {
    const res = await request(app)
      .post(`/api/runs/${PLAN_ID}/stop`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(0);
    expect(res.body.killed).toBe(0);
    expect(res.body.hu_reset_count).toBe(0);
    expect(res.body.message).toMatch(/No active runs and no stuck HUs/);
  });

  it('POST /stop con un PID falso (no existe) tras tracking devuelve errors + sigue limpio', async () => {
    // Tracking de un PID que ya no existe (filtrado en getActiveRuns).
    trackerMod.trackRun(PLAN_ID, { pid: 99999999 });
    const res = await request(app)
      .post(`/api/runs/${PLAN_ID}/stop`)
      .send({ timeoutMs: 50 });
    // getActiveRuns filtra el muerto antes de matar → sin runs activos.
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(0);
    expect(res.body.killed).toBe(0);
  });

  it('POST /stop resetea HUs en coding/reviewing del plan a pending', async () => {
    // Pasamos la HU 001 a coding manualmente vía API para tener algo
    // que resetear. Esto NO necesita un run real, solo el reset de DB.
    await request(app)
      .patch(`/api/stories/${encodeURIComponent(`${PROJECT_ID}::${PLAN_ID}_001`)}`)
      .send({ status: 'certified' });
    // Ahora simulamos que estaba coding (bypass API porque no acepta coding):
    dbMod.getDb().prepare(
      "UPDATE stories SET status = 'coding' WHERE id = ?"
    ).run(`${PROJECT_ID}::${PLAN_ID}_001`);

    const res = await request(app)
      .post(`/api/runs/${PLAN_ID}/stop`)
      .send({ timeoutMs: 10 });
    expect(res.status).toBe(200);
    expect(res.body.hu_reset_count).toBeGreaterThanOrEqual(1);

    const row = dbMod.getDb().prepare(
      'SELECT status FROM stories WHERE id = ?'
    ).get(`${PROJECT_ID}::${PLAN_ID}_001`);
    expect(row.status).toBe('pending');
  });
});

describe('GET /api/plans/:planId/log', () => {
  it('returns exists:false when the log file does not exist yet', async () => {
    const res = await request(app).get(`/api/plans/${PLAN_ID}/log`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false, size: 0, content: '' });
  });

  it('tails the log from a given offset', async () => {
    // Seed a fake log file at the path `runPlan` would write to.
    const runsDir = join(tmpHome, 'hu-board-runs');
    mkdirSync(runsDir, { recursive: true });
    const logPath = join(runsDir, `${PLAN_ID}.log`);
    writeFileSync(logPath, 'first chunk\nsecond chunk\n', 'utf-8');

    const firstBytes = Buffer.byteLength('first chunk\nsecond chunk\n');
    const full = await request(app).get(`/api/plans/${PLAN_ID}/log`);
    expect(full.status).toBe(200);
    expect(full.body.exists).toBe(true);
    expect(full.body.size).toBe(firstBytes);
    expect(full.body.content).toBe('first chunk\nsecond chunk\n');

    // Append more, read only delta.
    writeFileSync(logPath, 'first chunk\nsecond chunk\nthird chunk\n', 'utf-8');
    const totalBytes = Buffer.byteLength('first chunk\nsecond chunk\nthird chunk\n');
    const delta = await request(app)
      .get(`/api/plans/${PLAN_ID}/log`)
      .query({ offset: firstBytes });
    expect(delta.body.content).toBe('third chunk\n');
    expect(delta.body.size).toBe(totalBytes);
  });

  it('clamps a too-large offset to the file size', async () => {
    const runsDir = join(tmpHome, 'hu-board-runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, `${PLAN_ID}.log`), 'hello\n', 'utf-8');

    const res = await request(app)
      .get(`/api/plans/${PLAN_ID}/log`)
      .query({ offset: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('');
  });
});

describe('plan_order topological stamping', () => {
  it('stamps plan_order = index in plan.hus[] so cards sort roots-first', () => {
    writePlanToDisk({
      hus: [
        { id: `${PLAN_ID}_001`, title: 'root', status: 'pending', acceptance_criteria: [], blocked_by: [], createdAt: 'a', updatedAt: 'a' },
        { id: `${PLAN_ID}_002`, title: 'mid',  status: 'pending', acceptance_criteria: [], blocked_by: [`${PLAN_ID}_001`], createdAt: 'b', updatedAt: 'b' },
        { id: `${PLAN_ID}_003`, title: 'leaf', status: 'pending', acceptance_criteria: [], blocked_by: [`${PLAN_ID}_002`], createdAt: 'c', updatedAt: 'c' },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const stories = dbMod.getStoriesByProject(PROJECT_ID);
    // getStoriesByProject orders by plan_order ASC, so roots first,
    // then their dependents — matching kj run --plan's topo sort.
    expect(stories[0].id).toBe(`${PROJECT_ID}::${PLAN_ID}_001`);
    expect(stories[1].id).toBe(`${PROJECT_ID}::${PLAN_ID}_002`);
    expect(stories[2].id).toBe(`${PROJECT_ID}::${PLAN_ID}_003`);
    expect(stories[0].plan_order).toBe(0);
    expect(stories[2].plan_order).toBe(2);
  });
});

describe('empty acceptance_tests entries must not inflate test_count', () => {
  it('ignores null, empty strings, and structureless objects', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_900`,
          title: 'noise',
          status: 'pending',
          acceptance_criteria: [],
          acceptance_tests: ['', null, { foo: 'bar' }, '   ', {}],
          blocked_by: [],
          createdAt: 'a', updatedAt: 'a',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const row = dbMod.getStoriesByProject(PROJECT_ID).find((s) => s.id.endsWith('_900'));
    expect(row.test_count).toBe(0);
    expect(row.acceptance_tests).toBeNull();
  });

  it('keeps real string tests and Gherkin objects', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_901`,
          title: 'real',
          status: 'pending',
          acceptance_criteria: [],
          acceptance_tests: ['npx vitest', { given: 'x', when: 'y', then: 'z' }, ''],
          blocked_by: [],
          createdAt: 'a', updatedAt: 'a',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const row = dbMod.getStoriesByProject(PROJECT_ID).find((s) => s.id.endsWith('_901'));
    expect(row.test_count).toBe(2);
  });

  // Regression for the v2.7.5 dogfooding hit: the synthesizer (PR #502)
  // emits `{ type: "shell" | "gherkin", content: "..." }`. The original
  // anti-junk filter only knew the legacy shape (name/title/given/…)
  // and rejected every structured entry, leaving test_count = 0 on
  // the board even though the plan JSON had 4 tests apiece.
  it('keeps v2.7.5 structured form { type, content, file? } from the synthesizer', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_902`,
          title: 'structured',
          status: 'pending',
          acceptance_criteria: [],
          acceptance_tests: [
            { type: 'shell', content: 'npx vitest run path/to/spec.test.ts' },
            { type: 'gherkin', content: 'Given x\nWhen y\nThen z' },
            { type: 'shell', content: 'tsc --noEmit', file: 'tsconfig.json' },
            { type: 'shell', content: '   ' },              // empty content → drop
            { type: 'shell' },                               // no content    → drop
          ],
          blocked_by: [],
          createdAt: 'a', updatedAt: 'a',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const row = dbMod.getStoriesByProject(PROJECT_ID).find((s) => s.id.endsWith('_902'));
    expect(row.test_count).toBe(3);
    expect(row.acceptance_tests).not.toBeNull();
  });
});

describe('acceptance_tests stamping', () => {
  it('persists acceptance_tests JSON on the story row so the modal can render the list', () => {
    writePlanToDisk({
      hus: [
        {
          id: `${PLAN_ID}_500`,
          title: 'with tests',
          status: 'pending',
          acceptance_criteria: [],
          acceptance_tests: [
            'it should do the thing',
            { given: 'x', when: 'y', then: 'z' },
          ],
          blocked_by: [],
          createdAt: '2026-04-24T10:10:10Z',
          updatedAt: '2026-04-24T10:10:10Z',
        },
      ],
    });
    syncMod.syncPlanFile(planPath());
    const stories = dbMod.getStoriesByProject(PROJECT_ID);
    const row = stories.find((s) => s.id.endsWith('_500'));
    expect(row.test_count).toBe(2);
    const tests = JSON.parse(row.acceptance_tests);
    expect(tests[0]).toBe('it should do the thing');
    expect(tests[1].given).toBe('x');
  });
});

describe('POST /api/projects/:id/run', () => {
  it('launches every plan of the project', async () => {
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent(PROJECT_ID)}/run`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.launched).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('returns 404 when the project has no plan-backed stories', async () => {
    dbMod.upsertProject({ id: 'bare-project', name: 'Bare' });
    dbMod.upsertStory({ id: 'bare-project::hu-x', project_id: 'bare-project', status: 'pending' });
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent('bare-project')}/run`)
      .send({});
    expect(res.status).toBe(404);
  });
});
