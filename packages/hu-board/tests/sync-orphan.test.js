import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let savedKjHome;
let savedPlansDir;
let consoleSpy;

beforeEach(() => {
  tmpHome = join(tmpdir(), `kj-orphan-${process.pid}-${Date.now()}`);
  mkdirSync(join(tmpHome, 'sessions'), { recursive: true });
  mkdirSync(join(tmpHome, 'hu-stories'), { recursive: true });
  mkdirSync(join(tmpHome, 'plans'), { recursive: true });

  savedKjHome = process.env.KJ_HOME;
  savedPlansDir = process.env.KJ_PLANS_DIR;
  process.env.KJ_HOME = tmpHome;
  process.env.KJ_PLANS_DIR = join(tmpHome, 'plans');
  consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  if (savedKjHome === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = savedKjHome;
  if (savedPlansDir === undefined) delete process.env.KJ_PLANS_DIR; else process.env.KJ_PLANS_DIR = savedPlansDir;
  consoleSpy?.mockRestore();
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('sync.js — orphan-proof (PR-B)', () => {
  it('skips a session.json without project_id and no matching batch', async () => {
    const dir = join(tmpHome, 'sessions', 'sess-orphan');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify({
      id: 'sess-orphan',
      task: 'whatever',
      status: 'running',
      project_id: null,
    }));
    const { initDb, getDb } = await import('../src/db.js');
    initDb();
    const { fullScan } = await import('../src/sync.js');
    fullScan();
    const projects = getDb().prepare('SELECT id FROM projects').all();
    expect(projects.find(p => p.id === 'default')).toBeUndefined();
    expect(projects.find(p => p.id === 'sess-orphan')).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/orphan/i));
  });

  it('still ingests a session.json when project_id is present', async () => {
    const dir = join(tmpHome, 'sessions', 'sess-good');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify({
      id: 'sess-good',
      task: 'good task',
      status: 'approved',
      project_id: 'my-project',
    }));
    const { initDb, getDb } = await import('../src/db.js');
    initDb();
    const { fullScan } = await import('../src/sync.js');
    fullScan();
    const proj = getDb().prepare('SELECT id, name FROM projects WHERE id = ?').get('my-project');
    expect(proj).toBeDefined();
    expect(proj.id).toBe('my-project');
  });

  it('attaches a session to its auto-batch project when the batch session id starts with auto-', async () => {
    // Pre-create the auto-batch under hu-stories/ so syncStoryFile registers
    // the project. The session's id matches so syncSessionFile picks it up.
    const huDir = join(tmpHome, 'hu-stories', 'auto-sess-paired');
    mkdirSync(huDir, { recursive: true });
    writeFileSync(join(huDir, 'batch.json'), JSON.stringify({
      session_id: 'auto-sess-paired',
      stories: [{ id: 'HU-1', status: 'pending', original: { text: 'hello' } }],
    }));
    const sessDir = join(tmpHome, 'sessions', 'auto-sess-paired');
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, 'session.json'), JSON.stringify({
      id: 'auto-sess-paired', task: 'paired', status: 'running', project_id: null,
    }));
    const { initDb, getDb } = await import('../src/db.js');
    initDb();
    const { fullScan } = await import('../src/sync.js');
    fullScan();
    // The auto-batch project should exist; the orphan-skip logic must NOT
    // have rejected the session (because the batch project covers it).
    const projects = getDb().prepare('SELECT id FROM projects').all();
    expect(projects.find(p => p.id === 'auto-sess-paired')).toBeDefined();
  });
});

describe('sync.js — plan name preference (PR-B)', () => {
  it('prefers plan.name over titleCaseBasename(projectDir)', async () => {
    const projDir = join(tmpHome, 'plans', 'home_user_misleading-folder');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'plan-A.json'), JSON.stringify({
      planId: 'plan-A',
      version: 2,
      name: 'My Real Project Name',
      projectDir: '/home/user/misleading-folder',
      task: 'do stuff',
      status: 'draft',
      hus: [{ id: 'hu_plan-A_001', title: 'h1', status: 'pending' }],
    }));
    const { initDb, getDb } = await import('../src/db.js');
    initDb();
    const { fullScan } = await import('../src/sync.js');
    fullScan();
    const proj = getDb().prepare("SELECT name FROM projects WHERE id = 'home_user_misleading-folder'").get();
    expect(proj.name).toBe('My Real Project Name');
  });

  it('falls back to titleCaseBasename when plan.name is missing', async () => {
    const projDir = join(tmpHome, 'plans', 'home_user_some-tool');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'plan-B.json'), JSON.stringify({
      planId: 'plan-B',
      version: 2,
      projectDir: '/home/user/some-tool',
      task: 'do stuff',
      status: 'draft',
      hus: [{ id: 'hu_plan-B_001', title: 'h1', status: 'pending' }],
    }));
    const { initDb, getDb } = await import('../src/db.js');
    initDb();
    const { fullScan } = await import('../src/sync.js');
    fullScan();
    const proj = getDb().prepare("SELECT name FROM projects WHERE id = 'home_user_some-tool'").get();
    expect(proj.name).toBe('Some Tool');
  });
});
