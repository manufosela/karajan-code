import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// KJC-PRP-0002 PR2: HU Board sync scans `<projectDir>/.karajan-shared/plans/`
// in addition to the per-user `~/.karajan/plans/` cache, so teammates pulling
// the repo see the same HUs without re-running `kj plan`.

let tmpDir;
let projectADir;
let projectBDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-shared-'));
  process.env.KJ_HOME = tmpDir;
  // Isolate the local plans dir so a stale `~/.karajan/plans/` on the
  // dev's machine doesn't bleed into these fixtures.
  process.env.KJ_PLANS_DIR = join(tmpDir, '_empty_plans_');
  projectADir = join(tmpDir, 'projA');
  projectBDir = join(tmpDir, 'projB');
  mkdirSync(projectADir, { recursive: true });
  mkdirSync(projectBDir, { recursive: true });
});

afterEach(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
  delete process.env.KJ_SHARED_PROJECT_DIRS;
});

async function setup() {
  const db = await import('../src/db.js');
  db.initDb();
  const sync = await import('../src/sync.js');
  return { db, sync };
}

function writeSharedPlan(projectDir, planId, extras = {}) {
  const dir = join(projectDir, '.karajan-shared', 'plans');
  mkdirSync(dir, { recursive: true });
  const plan = {
    version: 2,
    planId,
    task: extras.task || 'shared task',
    projectDir,
    name: extras.name || 'Shared Project',
    hus: [{ id: 'hu-shared-01', status: 'pending', title: 'Login' }],
    status: 'draft',
    shared: true,
    sharedAt: '2026-05-26T00:00:00Z',
    createdAt: '2026-05-26T00:00:00Z',
  };
  writeFileSync(join(dir, `${planId}.json`), JSON.stringify(plan));
  return plan;
}

function findProject(db, name) {
  return db.getProjects().find((p) => p.name === name);
}

describe('HU Board sync — .karajan-shared/plans/ scan (KJC-PRP-0002 PR2)', () => {
  it('imports a shared plan from process.cwd()/.karajan-shared/plans/', async () => {
    const { db, sync } = await setup();
    const originalCwd = process.cwd();
    try {
      process.chdir(projectADir);
      writeSharedPlan(projectADir, 'plan-shared-001', { name: 'CwdProj' });
      sync.fullScan();
      const proj = findProject(db, 'CwdProj');
      expect(proj).toBeTruthy();
      // KJC-PRP-0002 PR3: the project is stamped is_shared=1 because the plan
      // came from `.karajan-shared/plans/`. UI uses this for the 🔗 badge.
      expect(proj.is_shared).toBe(1);
      const stories = db.getStoriesByProject(proj.id);
      expect(stories.length).toBe(1);
      expect(stories[0].title).toBe('Login');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('honors KJ_SHARED_PROJECT_DIRS for boards running outside the project root', async () => {
    const { db, sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = `${projectADir}:${projectBDir}`;
    writeSharedPlan(projectADir, 'plan-mp-A', { name: 'ProjA' });
    writeSharedPlan(projectBDir, 'plan-mp-B', { name: 'ProjB' });
    sync.fullScan();
    expect(findProject(db, 'ProjA')).toBeTruthy();
    expect(findProject(db, 'ProjB')).toBeTruthy();
  });

  it('skips silently when .karajan-shared/plans/ does not exist', async () => {
    const { sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = projectADir;
    expect(() => sync.fullScan()).not.toThrow();
  });
});
