// KJC-BUG-0162 — every board project showed up as "brain-backlog": the
// default backlog plan's own name was winning over the project directory.
// A DEFAULT name is not a user choice — only a real, user-given plan name
// may override the name derived from the repo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-name-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, '_empty_plans_');
});

afterEach(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

function writeSharedPlan(projectDir, planId, name) {
  const dir = join(projectDir, '.karajan-shared', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${planId}.json`),
    JSON.stringify({
      version: 2,
      planId,
      task: 'default backlog',
      projectDir,
      name,
      hus: [{ id: 'hu-01', status: 'pending', title: 'Una tarea' }],
      status: 'draft',
      shared: true,
      createdAt: '2026-09-06T00:00:00Z',
    }),
  );
}

describe('board project naming (KJC-BUG-0162)', () => {
  it('the default backlog name never names the project — the repo directory does', async () => {
    const projectDir = join(tmpDir, 'mi-tienda');
    mkdirSync(projectDir, { recursive: true });
    writeSharedPlan(projectDir, 'plan-0162a', 'brain-backlog');
    const db = await import('../src/db.js');
    db.initDb();
    const sync = await import('../src/sync.js');
    const originalCwd = process.cwd();
    try {
      process.chdir(projectDir);
      await sync.fullScan();
    } finally {
      process.chdir(originalCwd);
    }
    const project = db.getProjects().find((p) => p.id.includes('mi-tienda'));
    expect(project).toBeTruthy();
    expect(project.name).toBe('Mi Tienda');
  });

  it('a real, user-given plan name still wins over the directory', async () => {
    const projectDir = join(tmpDir, 'otro-dir');
    mkdirSync(projectDir, { recursive: true });
    writeSharedPlan(projectDir, 'plan-0162b', 'Linux Assistant');
    const db = await import('../src/db.js');
    db.initDb();
    const sync = await import('../src/sync.js');
    const originalCwd = process.cwd();
    try {
      process.chdir(projectDir);
      await sync.fullScan();
    } finally {
      process.chdir(originalCwd);
    }
    const project = db.getProjects().find((p) => p.id.includes('otro-dir'));
    expect(project).toBeTruthy();
    expect(project.name).toBe('Linux Assistant');
  });
});
