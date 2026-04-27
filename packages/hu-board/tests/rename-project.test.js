import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpKj;
let savedKjHome;
let savedPlansDir;

beforeEach(() => {
  tmpKj = join(tmpdir(), `kj-rename-${process.pid}-${Date.now()}`);
  mkdirSync(join(tmpKj, 'plans', 'proj-X'), { recursive: true });
  // Two plan JSONs in this project so we can verify renameProject
  // updates ALL of them.
  writeFileSync(join(tmpKj, 'plans', 'proj-X', 'plan-1.json'), JSON.stringify({
    planId: 'plan-1', version: 2, projectDir: '/x', task: 't',
    name: 'Old Name', status: 'draft',
    hus: [{ id: 'hu_plan-1_001', title: 'h', status: 'pending' }],
  }));
  writeFileSync(join(tmpKj, 'plans', 'proj-X', 'plan-2.json'), JSON.stringify({
    planId: 'plan-2', version: 2, projectDir: '/x', task: 't',
    name: 'Old Name', status: 'draft',
    hus: [{ id: 'hu_plan-2_001', title: 'h', status: 'pending' }],
  }));
  savedKjHome = process.env.KJ_HOME;
  savedPlansDir = process.env.KJ_PLANS_DIR;
  process.env.KJ_HOME = tmpKj;
  process.env.KJ_PLANS_DIR = join(tmpKj, 'plans');
  vi.resetModules();
});

afterEach(() => {
  if (savedKjHome === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = savedKjHome;
  if (savedPlansDir === undefined) delete process.env.KJ_PLANS_DIR; else process.env.KJ_PLANS_DIR = savedPlansDir;
  try { rmSync(tmpKj, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('renameProject (PR-G)', () => {
  it('updates plan.name on EVERY plan JSON belonging to the project', async () => {
    const { initDb, upsertProject } = await import('../src/db.js');
    initDb();
    upsertProject({ id: 'proj-X', name: 'Old Name', total_stories: 0 });
    const { renameProject } = await import('../src/plan-mutations.js');

    const r = renameProject({ projectId: 'proj-X', name: 'Brand New Name' });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Brand New Name');
    expect(r.plansUpdated).toBe(2);

    const p1 = JSON.parse(readFileSync(join(tmpKj, 'plans', 'proj-X', 'plan-1.json'), 'utf8'));
    const p2 = JSON.parse(readFileSync(join(tmpKj, 'plans', 'proj-X', 'plan-2.json'), 'utf8'));
    expect(p1.name).toBe('Brand New Name');
    expect(p2.name).toBe('Brand New Name');
  });

  it('updates the SQLite project row directly', async () => {
    const { initDb, upsertProject, getDb } = await import('../src/db.js');
    initDb();
    upsertProject({ id: 'proj-X', name: 'Old Name', total_stories: 0 });
    const { renameProject } = await import('../src/plan-mutations.js');
    renameProject({ projectId: 'proj-X', name: 'New' });
    const row = getDb().prepare('SELECT name FROM projects WHERE id = ?').get('proj-X');
    expect(row.name).toBe('New');
  });

  it('rejects empty / whitespace-only names', async () => {
    const { initDb } = await import('../src/db.js');
    initDb();
    const { renameProject } = await import('../src/plan-mutations.js');
    expect(renameProject({ projectId: 'proj-X', name: '' }).ok).toBe(false);
    expect(renameProject({ projectId: 'proj-X', name: '   ' }).ok).toBe(false);
    expect(renameProject({ projectId: 'proj-X', name: null }).ok).toBe(false);
  });

  it('rejects names longer than 120 characters', async () => {
    const { initDb } = await import('../src/db.js');
    initDb();
    const { renameProject } = await import('../src/plan-mutations.js');
    const long = 'x'.repeat(121);
    const r = renameProject({ projectId: 'proj-X', name: long });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/120/);
  });

  it('returns 404-equivalent error when no plans + no SQLite row exist for the project', async () => {
    const { initDb } = await import('../src/db.js');
    initDb();
    const { renameProject } = await import('../src/plan-mutations.js');
    // No plans dir for this project + no SQLite row → not found.
    const r = renameProject({ projectId: 'no-such-project', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no encontrado/i);
  });

  it('trims surrounding whitespace before saving', async () => {
    const { initDb, upsertProject } = await import('../src/db.js');
    initDb();
    upsertProject({ id: 'proj-X', name: 'Old', total_stories: 0 });
    const { renameProject } = await import('../src/plan-mutations.js');
    const r = renameProject({ projectId: 'proj-X', name: '   Padded   ' });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Padded');
  });
});
