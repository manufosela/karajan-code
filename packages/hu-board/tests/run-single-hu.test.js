import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpKj;
let savedPlansDir;
let savedSpawnMode;

beforeEach(() => {
  tmpKj = join(tmpdir(), `kj-runhu-${process.pid}-${Date.now()}`);
  // plan-mutations.js::plansRoot prefers KJ_PLANS_DIR over KJ_HOME, and
  // vitest.config.js sets KJ_PLANS_DIR globally to a placeholder. Override
  // it here so findPlanFilePath sees our fixture.
  const plansDir = join(tmpKj, 'plans');
  mkdirSync(join(plansDir, 'proj1'), { recursive: true });

  writeFileSync(join(plansDir, 'proj1', 'plan-X.json'), JSON.stringify({
    planId: 'plan-X',
    version: 2,
    projectDir: '/some/proj',
    task: 'do stuff',
    status: 'ready',
    hus: [
      { id: 'hu_plan-X_001', title: 'h1', status: 'certified' },
      { id: 'hu_plan-X_002', title: 'h2', status: 'certified' },
      { id: 'hu_plan-X_003', title: 'h3', status: 'certified' },
    ],
  }));

  savedPlansDir = process.env.KJ_PLANS_DIR;
  process.env.KJ_PLANS_DIR = plansDir;
  savedSpawnMode = process.env.KJ_RUN_SPAWN_MODE;
  process.env.KJ_RUN_SPAWN_MODE = 'echo';     // never actually spawn
  vi.resetModules();
});

afterEach(() => {
  if (savedPlansDir === undefined) delete process.env.KJ_PLANS_DIR;
  else process.env.KJ_PLANS_DIR = savedPlansDir;
  if (savedSpawnMode === undefined) delete process.env.KJ_RUN_SPAWN_MODE;
  else process.env.KJ_RUN_SPAWN_MODE = savedSpawnMode;
  try { rmSync(tmpKj, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('runPlan with huIds (PR4)', () => {
  it('returns the same shape when no huIds is set (back-compat)', async () => {
    const { runPlan } = await import('../src/plan-mutations.js');
    const r = runPlan({ planId: 'plan-X', projectId: 'proj1' });
    expect(r.ok).toBe(true);
    expect(r.argv).toBeDefined();
    expect(r.argv.join(' ')).toMatch(/--plan plan-X/);
    expect(r.argv.join(' ')).not.toMatch(/--hu/);
    expect(r.huIds).toBeNull();
  });

  it('appends --hu <ids> to the spawn argv when huIds is passed', async () => {
    const { runPlan } = await import('../src/plan-mutations.js');
    const r = runPlan({ planId: 'plan-X', projectId: 'proj1', huIds: ['hu_plan-X_002'] });
    expect(r.ok).toBe(true);
    expect(r.argv.join(' ')).toMatch(/--plan plan-X --hu hu_plan-X_002/);
    expect(r.huIds).toEqual(['hu_plan-X_002']);
  });

  it('joins multiple huIds with comma', async () => {
    const { runPlan } = await import('../src/plan-mutations.js');
    const r = runPlan({ planId: 'plan-X', projectId: 'proj1', huIds: ['hu_plan-X_001', 'hu_plan-X_003'] });
    expect(r.ok).toBe(true);
    expect(r.argv.join(' ')).toMatch(/--hu hu_plan-X_001,hu_plan-X_003/);
  });

  it('rejects huIds that do not exist on the plan', async () => {
    const { runPlan } = await import('../src/plan-mutations.js');
    const r = runPlan({ planId: 'plan-X', projectId: 'proj1', huIds: ['nope_001', 'hu_plan-X_002'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown HU/);
  });

  it('uses a per-HU log filename so a full-plan run does not overwrite it', async () => {
    const { runPlan } = await import('../src/plan-mutations.js');
    const single = runPlan({ planId: 'plan-X', projectId: 'proj1', huIds: ['hu_plan-X_002'] });
    const full   = runPlan({ planId: 'plan-X', projectId: 'proj1' });
    expect(single.logPath).not.toBe(full.logPath);
    expect(single.logPath).toMatch(/plan-X--hu-hu_plan-X_002\.log$/);
    expect(full.logPath).toMatch(/plan-X\.log$/);
  });
});
