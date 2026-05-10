/**
 * KJC-TSK-0380 PR C — Zombi cleanup script.
 *
 * Covers detection + removal of:
 *  - Ephemeral projects (tmp_/test_/demo_/kj-test-/s_/plan- prefixes)
 *    older than `staleProjectDays`.
 *  - Stale prompts (no answer, mtime > stalePromptHours).
 *  - Orphan session directories not present in DB.
 *
 * Critical invariants:
 *  - dryRun never mutates DB or filesystem.
 *  - Real cleanup tombstones the resource (so fullScan can't restore it)
 *    AND removes the filesystem path.
 *  - Active (non-stale) ephemerals are NOT touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

let tmpDir;
let dbMod;
let cleanupMod;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-cleanup-'));
  process.env.KJ_HOME = tmpDir;
  process.env.KJ_PLANS_DIR = join(tmpDir, '.kj', 'plans');
  dbMod = await import('../src/db.js');
  dbMod.initDb();
  cleanupMod = await import('../src/cleanup-zombies.js');
});

afterEach(() => {
  dbMod.closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_PLANS_DIR;
});

function ageDir(p, daysAgo) {
  const old = new Date(Date.now() - daysAgo * 86400_000);
  utimesSync(p, old, old);
}
function ageFile(p, hoursAgo) {
  const old = new Date(Date.now() - hoursAgo * 3600_000);
  utimesSync(p, old, old);
}
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

describe('cleanupZombies', () => {
  it('detects + removes ephemeral projects older than the threshold', () => {
    dbMod.upsertProject({ id: 'tmp_old', name: 'old', last_activity: isoDaysAgo(15) });
    dbMod.upsertProject({ id: 'tmp_recent', name: 'recent', last_activity: isoDaysAgo(2) });
    dbMod.upsertProject({ id: 'home_real_project', name: 'real', last_activity: isoDaysAgo(30) });

    const r = cleanupMod.cleanupZombies({ staleProjectDays: 7 });

    expect(r.projects).toContain('tmp_old');
    expect(r.projects).not.toContain('tmp_recent');     // too new
    expect(r.projects).not.toContain('home_real_project'); // not ephemeral
    expect(dbMod.isTombstoned('project', 'tmp_old')).toBe(true);
    expect(dbMod.isTombstoned('project', 'tmp_recent')).toBe(false);
  });

  it('catches all ephemeral prefixes (tmp_/test_/demo_/kj-test-/s_/plan-)', () => {
    for (const id of ['tmp_x', 'test_x', 'demo_x', 'kj-test-x', 's_x', 'plan-x']) {
      dbMod.upsertProject({ id, name: id, last_activity: isoDaysAgo(30) });
    }
    const r = cleanupMod.cleanupZombies({ staleProjectDays: 7 });
    expect(r.projects).toHaveLength(6);
  });

  it('dryRun reports but does not touch DB or filesystem', () => {
    dbMod.upsertProject({ id: 'tmp_zombi', name: 'z', last_activity: isoDaysAgo(30) });

    const r = cleanupMod.cleanupZombies({ dryRun: true, staleProjectDays: 7 });

    expect(r.projects).toEqual(['tmp_zombi']);
    expect(r.dryRun).toBe(true);
    expect(dbMod.isTombstoned('project', 'tmp_zombi')).toBe(false);
    expect(dbMod.getProjects().find((p) => p.id === 'tmp_zombi')).toBeDefined();
  });

  it('removes prompt files without answer that are older than stalePromptHours', () => {
    const promptsDir = join(tmpDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    const stale = join(promptsDir, 'pr-old.json');
    const fresh = join(promptsDir, 'pr-new.json');
    const answered = join(promptsDir, 'pr-done.json');
    writeFileSync(stale, '{"promptId":"pr-old"}');
    writeFileSync(fresh, '{"promptId":"pr-new"}');
    writeFileSync(answered, '{"promptId":"pr-done"}');
    writeFileSync(join(promptsDir, 'pr-done.answer.json'), '{}');
    ageFile(stale, 48);
    ageFile(answered, 48);
    ageFile(fresh, 1);

    const r = cleanupMod.cleanupZombies({ stalePromptHours: 24 });

    expect(r.prompts).toEqual(['pr-old']);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(answered)).toBe(true); // answered prompts are not stale
    expect(dbMod.isTombstoned('prompt', 'pr-old')).toBe(true);
  });

  it('removes orphan session directories with no matching DB row', () => {
    const sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(join(sessionsDir, 'orphan-s'), { recursive: true });
    mkdirSync(join(sessionsDir, 'active-s'), { recursive: true });
    dbMod.upsertSession({ id: 'active-s', project_id: 'p1', status: 'running' });
    ageDir(join(sessionsDir, 'orphan-s'), 10);
    ageDir(join(sessionsDir, 'active-s'), 10);

    const r = cleanupMod.cleanupZombies({ staleProjectDays: 7 });

    expect(r.sessions).toEqual(['orphan-s']);
    expect(existsSync(join(sessionsDir, 'orphan-s'))).toBe(false);
    expect(existsSync(join(sessionsDir, 'active-s'))).toBe(true);
  });

  it('returns an empty report when board is already clean', () => {
    dbMod.upsertProject({ id: 'home_real', name: 'real', last_activity: isoDaysAgo(30) });
    const r = cleanupMod.cleanupZombies({ staleProjectDays: 7 });
    expect(r).toEqual({ projects: [], prompts: [], sessions: [], dryRun: false });
  });

  it('skips already-tombstoned prompts to avoid double counting', () => {
    const promptsDir = join(tmpDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    const f = join(promptsDir, 'pr-buried.json');
    writeFileSync(f, '{"promptId":"pr-buried"}');
    ageFile(f, 48);
    dbMod.addTombstone('prompt', 'pr-buried');

    const r = cleanupMod.cleanupZombies({ stalePromptHours: 24 });
    expect(r.prompts).toHaveLength(0);
  });
});
