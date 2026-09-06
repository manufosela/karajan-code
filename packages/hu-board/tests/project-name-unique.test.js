// KJC-BUG-0163 — the iron rule: a project NAME is unique on the dashboard.
// Registering a project whose name already belongs to a DIFFERENT id fails
// LOUD (the conflicting project is not silently registered), and the sync
// survives: other projects keep syncing. No silent auto-disambiguation —
// the error IS the signal that something needs a better name.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-unique-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, '_empty_plans_');
});

afterEach(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
  delete process.env.KJ_SHARED_PROJECT_DIRS;
});

describe('project name uniqueness (KJC-BUG-0163)', () => {
  it('upsertProject throws when the name belongs to another project id', async () => {
    const db = await import('../src/db.js');
    db.initDb();
    db.upsertProject({ id: 'proj_a', name: 'Mi Tienda', last_activity: '2026-09-06T00:00:00Z', total_stories: 1 });
    expect(() =>
      db.upsertProject({ id: 'proj_b', name: 'Mi Tienda', last_activity: '2026-09-06T00:00:00Z', total_stories: 1 }),
    ).toThrow(/Mi Tienda/);
    const names = db.getProjects().map((p) => p.id);
    expect(names).toContain('proj_a');
    expect(names).not.toContain('proj_b');
  });

  it('updating the SAME project id with its own name still works', async () => {
    const db = await import('../src/db.js');
    db.initDb();
    db.upsertProject({ id: 'proj_a', name: 'Mi Tienda', last_activity: '2026-09-06T00:00:00Z', total_stories: 1 });
    expect(() =>
      db.upsertProject({ id: 'proj_a', name: 'Mi Tienda', last_activity: '2026-09-06T01:00:00Z', total_stories: 2 }),
    ).not.toThrow();
    expect(db.getProjects().length).toBe(1);
  });

  it('a name collision in one plan does not break the sync of the others', async () => {
    // Two different dirs with the SAME basename derive the same name — the
    // exact confusion the rule exists to surface.
    const dirA = join(tmpDir, 'clones-a', 'mi-app');
    const dirB = join(tmpDir, 'clones-b', 'mi-app');
    const dirC = join(tmpDir, 'otra-cosa');
    for (const [dir, planId] of [[dirA, 'plan-ua'], [dirB, 'plan-ub'], [dirC, 'plan-uc']]) {
      const plansDir = join(dir, '.karajan-shared', 'plans');
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(
        join(plansDir, `${planId}.json`),
        JSON.stringify({
          version: 2, planId, task: 't', projectDir: dir, name: 'brain-backlog',
          hus: [{ id: 'hu-1', status: 'pending', title: 'x' }],
          status: 'draft', shared: true, createdAt: '2026-09-06T00:00:00Z',
        }),
      );
    }
    const db = await import('../src/db.js');
    db.initDb();
    const sync = await import('../src/sync.js');
    // One scan that SEES all three plans (the multi-repo escape hatch) — a
    // per-cwd sequence would trip orphan pruning instead of the name rule.
    process.env.KJ_SHARED_PROJECT_DIRS = `${dirA}:${dirB}:${dirC}`;
    await sync.fullScan();
    const projects = db.getProjects();
    // One "Mi App" registered, the clone rejected, "Otra Cosa" untouched.
    expect(projects.filter((p) => p.name === 'Mi App').length).toBe(1);
    expect(projects.some((p) => p.name === 'Otra Cosa')).toBe(true);
  });
});
