/**
 * Cleanup zombi resources of the HU Board (KJC-TSK-0380 PR C).
 *
 * Detects and removes orphan / abandoned entries that survive across
 * dogfooding sessions and would otherwise reappear on every fullScan:
 *
 *  1. Ephemeral projects (`tmp_*`, `test_*`, `demo_*`, `kj-test-*`,
 *     `s_*`, `plan-*`) older than `staleProjectDays` (default 7).
 *  2. Stale prompts (no `.answer.json` and file mtime older than
 *     `stalePromptHours`, default 24).
 *  3. Orphan session directories (`~/.karajan/sessions/<id>/`) older
 *     than `staleProjectDays` with no matching DB row.
 *
 * Each removal goes through the same path the API endpoints use:
 * tombstone + fs cleanup. So nothing resurrects on the next sync.
 *
 * Usage:
 *   import { cleanupZombies } from './cleanup-zombies.js';
 *   const report = cleanupZombies({ dryRun: false });
 *
 * Pure module; no HTTP. Safe to call with the server down.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getDb,
  getKjHome,
  addTombstone,
  isTombstoned,
  deleteProject,
  deleteSession,
  initDb,
  closeDb,
} from './db.js';

// Re-export the db lifecycle helpers so callers (e.g. `kj board cleanup`)
// can do a single `await import('cleanup-zombies.js')` and stay within
// the project's dynamic-import budget. The script otherwise needs both
// initDb/closeDb (lifecycle) and cleanupZombies (logic).
export { initDb, closeDb };

const EPHEMERAL_PREFIXES = ['tmp_', 'test_', 'demo_', 'kj-test-', 's_', 'plan-'];

function isEphemeralId(id) {
  return EPHEMERAL_PREFIXES.some((p) => id.startsWith(p));
}

// KJC-BUG-0059 (v2.19.3): cleanup walks all known plan roots,
// canonical first then legacy. Pre-fix hard-coded `~/.kj/plans/`
// missed every plan post-v2.19.0 → zombies never garbage-collected.
import { getHuBoardPlansDirs } from './db.js';
function plansRoots() {
  return getHuBoardPlansDirs();
}

function olderThanDays(isoStr, days) {
  if (!isoStr) return true;
  const t = Date.parse(isoStr);
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) > days * 24 * 60 * 60 * 1000;
}

function olderThanHours(mtimeMs, hours) {
  return (Date.now() - mtimeMs) > hours * 60 * 60 * 1000;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.dryRun=false] - Compute the report without writing.
 * @param {number}  [opts.staleProjectDays=7]
 * @param {number}  [opts.stalePromptHours=24]
 * @returns {{ projects: string[], prompts: string[], sessions: string[], dryRun: boolean }}
 */
export function cleanupZombies(opts = {}) {
  const dryRun = !!opts.dryRun;
  const staleProjectDays = opts.staleProjectDays ?? 7;
  const stalePromptHours = opts.stalePromptHours ?? 24;

  const report = { projects: [], prompts: [], sessions: [], dryRun };
  const db = getDb();

  // (1) Ephemeral projects -------------------------------------------------
  const allProjects = db.prepare('SELECT id, last_activity FROM projects').all();
  for (const proj of allProjects) {
    if (!isEphemeralId(proj.id)) continue;
    if (!olderThanDays(proj.last_activity, staleProjectDays)) continue;
    report.projects.push(proj.id);
    if (dryRun) continue;

    const storyIds = db.prepare('SELECT id FROM stories WHERE project_id = ?').all(proj.id).map((r) => r.id);
    const sessionIds = db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(proj.id).map((r) => r.id);
    const fsPaths = [
      ...storyIds.map((sid) => path.join(getKjHome(), 'hu-stories', sid)),
      ...sessionIds.map((sid) => path.join(getKjHome(), 'sessions', sid)),
      ...plansRoots().map((root) => path.join(root, proj.id)),
    ];
    deleteProject(proj.id);
    addTombstone('project', proj.id, { source: 'auto-cleanup', fsPaths });
    for (const sid of storyIds) addTombstone('story', sid, { source: 'auto-cleanup' });
    for (const sid of sessionIds) addTombstone('session', sid, { source: 'auto-cleanup' });
    for (const p of fsPaths) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ } }
  }

  // (2) Stale prompts ------------------------------------------------------
  const promptsDir = path.join(getKjHome(), 'prompts');
  if (fs.existsSync(promptsDir)) {
    for (const name of fs.readdirSync(promptsDir)) {
      if (!name.endsWith('.json') || name.endsWith('.answer.json')) continue;
      const promptId = name.replace(/\.json$/, '');
      if (isTombstoned('prompt', promptId)) continue;
      const fullPath = path.join(promptsDir, name);
      const answerPath = path.join(promptsDir, `${promptId}.answer.json`);
      if (fs.existsSync(answerPath)) continue; // already resolved
      const stat = fs.statSync(fullPath);
      if (!olderThanHours(stat.mtimeMs, stalePromptHours)) continue;
      report.prompts.push(promptId);
      if (dryRun) continue;
      addTombstone('prompt', promptId, { source: 'auto-cleanup', fsPaths: [fullPath, answerPath] });
      try { fs.unlinkSync(fullPath); } catch { /* */ }
    }
  }

  // (3) Orphan session directories ----------------------------------------
  const sessionsDir = path.join(getKjHome(), 'sessions');
  if (fs.existsSync(sessionsDir)) {
    for (const dir of fs.readdirSync(sessionsDir)) {
      if (isTombstoned('session', dir)) continue;
      const fullPath = path.join(sessionsDir, dir);
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) continue;
      const inDb = db.prepare('SELECT id FROM sessions WHERE id = ?').get(dir);
      if (inDb) continue; // active session, not orphan
      const mtimeIso = new Date(stat.mtimeMs).toISOString();
      if (!olderThanDays(mtimeIso, staleProjectDays)) continue;
      report.sessions.push(dir);
      if (dryRun) continue;
      deleteSession(dir);
      addTombstone('session', dir, { source: 'auto-cleanup', fsPaths: [fullPath] });
      try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch { /* */ }
    }
  }

  return report;
}
