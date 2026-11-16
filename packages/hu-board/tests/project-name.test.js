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

  // KJC-BUG-0605 (the maintainer, 2026-11-15): two repos mirroring one Linear board did not show up:
  // the team board's mirror (src/hu/team-board-mirror.js) names its plan after the manager, "linear",
  // and only the first project could take that name. A mirror's name is no user choice either.
  it('a team board mirror\'s plan names no project: each takes its directory, and both sync', async () => {
    // As in ~/.karajan/plans: one folder per project, both mirrors with the same plan id.
    process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
    for (const repo of ['tribbu-app', 'tribbu-platform']) {
      const projectDir = join(tmpDir, repo);
      mkdirSync(projectDir, { recursive: true });
      const dir = join(tmpDir, 'plans', `home_${repo}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plan-linear-board.json'), JSON.stringify({
        version: 2, planId: 'plan-linear-board', name: 'linear', alias: 'linear', readonly: 'linear', projectDir,
        hus: [{ id: 'hu-01', status: 'pending', title: 'Una tarea' }], status: 'ready', createdAt: '2026-11-15T00:00:00Z',
      }));
    }
    const db = await import('../src/db.js');
    db.initDb();
    const sync = await import('../src/sync.js');
    await sync.fullScan();
    const names = db.getProjects().filter((p) => p.id.includes('tribbu-')).map((p) => p.name).sort();
    expect(names).toEqual(['Tribbu App', 'Tribbu Platform']);
  });

  // KJC-BUG-0619 (the maintainer, 2026-11-16): tribbu-platform vanished from the board and the stage.
  // One read of its Linear board came back empty, the mirror was rewritten with no HUs, and the board,
  // which skips an empty plan, gave it no project: its factory went and nothing refreshed it again.
  it('a team board mirror that comes back empty still keeps its project; a plain empty plan does not', async () => {
    process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
    const plan = (repo, extra) => {
      const projectDir = join(tmpDir, repo);
      mkdirSync(projectDir, { recursive: true });
      const dir = join(tmpDir, 'plans', `home_${repo}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plan-1.json'), JSON.stringify({ version: 2, planId: 'plan-1', projectDir, hus: [], status: 'ready', createdAt: '2026-11-16T00:00:00Z', ...extra }));
    };
    plan('mirrored-repo', { name: 'linear', alias: 'linear', readonly: 'linear' });
    plan('empty-repo', { name: 'Empty' });
    const db = await import('../src/db.js');
    db.initDb();
    const sync = await import('../src/sync.js');
    await sync.fullScan();
    const ids = db.getProjects().map((p) => p.id);
    expect(ids.some((id) => id.includes('mirrored-repo'))).toBe(true);
    expect(ids.some((id) => id.includes('empty-repo'))).toBe(false);
    expect(db.getProjects().find((p) => p.id.includes('mirrored-repo')).name).toBe('Mirrored Repo');
  });
});
