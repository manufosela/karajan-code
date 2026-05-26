import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

// KJC-PRP-0002 PR5: when the same planId lives in both
// ~/.karajan/plans/<slug>/ (per-user cache) and
// <projectDir>/.karajan-shared/plans/ (team copy), the conflict policy
// configured in kj.config.yml decides who wins. Default = shared-wins.

let tmpDir;
let projectDir;
let kjHome;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-conflict-'));
  kjHome = join(tmpDir, 'kj-home');
  mkdirSync(kjHome, { recursive: true });
  process.env.KJ_HOME = kjHome;
  // Per-user plans live under KJ_PLANS_DIR/<slug>/. Project dir hosts the
  // shared copy via .karajan-shared/plans/.
  process.env.KJ_PLANS_DIR = join(tmpDir, 'plans');
  mkdirSync(process.env.KJ_PLANS_DIR, { recursive: true });
  projectDir = join(tmpDir, 'projDir');
  mkdirSync(projectDir, { recursive: true });
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

function writePlanInDir(dir, planId, huTitle, projectName) {
  mkdirSync(dir, { recursive: true });
  const plan = {
    version: 2,
    planId,
    task: 'conflict policy test',
    projectDir,
    name: projectName,
    hus: [{ id: 'hu-policy-01', status: 'pending', title: huTitle }],
    status: 'draft',
    createdAt: '',
  };
  writeFileSync(join(dir, `${planId}.json`), JSON.stringify(plan));
}

function writeConfigPolicy(policy) {
  const yml = yaml.dump({ huBoard: { sharedConflictPolicy: policy } });
  writeFileSync(join(kjHome, 'kj.config.yml'), yml);
}

describe('HU Board sync — sharedConflictPolicy (KJC-PRP-0002 PR5)', () => {
  function seedBothCopies() {
    // Per-user copy says "Local title".
    writePlanInDir(
      join(process.env.KJ_PLANS_DIR, 'proj'),
      'plan-conflict-001',
      'Local title',
      'ConflictProj'
    );
    // Shared copy (committed in the repo) says "Shared title".
    const sharedDir = join(projectDir, '.karajan-shared', 'plans');
    writePlanInDir(sharedDir, 'plan-conflict-001', 'Shared title', 'ConflictProj');
    // Stamp the `shared:true` marker the way `kj plan share` does, so the
    // is_shared column is set deterministically.
    const sharedFile = join(sharedDir, 'plan-conflict-001.json');
    const parsed = JSON.parse(readFileSync(sharedFile, 'utf8'));
    parsed.shared = true;
    writeFileSync(sharedFile, JSON.stringify(parsed));
  }

  it('defaults to shared-wins when no policy is configured', async () => {
    const { db, sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = projectDir;
    seedBothCopies();
    sync.fullScan();
    const proj = db.getProjects().find((p) => p.name === 'ConflictProj');
    const stories = db.getStoriesByProject(proj.id);
    expect(stories[0].title).toBe('Shared title');
  });

  it('honors explicit shared-wins policy from kj.config.yml', async () => {
    writeConfigPolicy('shared-wins');
    const { db, sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = projectDir;
    seedBothCopies();
    sync.fullScan();
    const proj = db.getProjects().find((p) => p.name === 'ConflictProj');
    const stories = db.getStoriesByProject(proj.id);
    expect(stories[0].title).toBe('Shared title');
  });

  it('honors local-wins policy — per-user copy overrides the shared one', async () => {
    writeConfigPolicy('local-wins');
    const { db, sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = projectDir;
    seedBothCopies();
    sync.fullScan();
    const proj = db.getProjects().find((p) => p.name === 'ConflictProj');
    const stories = db.getStoriesByProject(proj.id);
    expect(stories[0].title).toBe('Local title');
  });

  it('falls back to shared-wins when the config value is malformed', async () => {
    // Garbage value should NOT be honored — we want the safe team default.
    writeConfigPolicy('newest-wins');
    const { db, sync } = await setup();
    process.env.KJ_SHARED_PROJECT_DIRS = projectDir;
    seedBothCopies();
    sync.fullScan();
    const proj = db.getProjects().find((p) => p.name === 'ConflictProj');
    const stories = db.getStoriesByProject(proj.id);
    expect(stories[0].title).toBe('Shared title');
  });
});
