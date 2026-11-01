import { watch } from 'chokidar';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getKjHome, getDb, isTombstoned } from './db.js';
import { publish as publishEvent } from './event-bus.js';
import { getSharedPlansDir, SHARED_DIR_NAME } from 'karajan-core/shared-paths';
import { readConfig } from './config-yaml.js';
import { syncSessionFile, syncPlanFile } from './sync-files.js';

// KJC-TSK-0542: the project naming lives in sync-project.js and the per-file sync in
// sync-files.js; callers keep importing them from here.
export { deriveProjectIdFromDir, canonicalProjectDir } from './sync-project.js';
export { syncPlanFile };

/**
 * KJC-PRP-0002 PR5: resolve the conflict policy that decides who wins
 * when the same planId is present in both the per-user cache
 * (~/.karajan/plans/<slug>/) and the shared dir (.karajan-shared/plans/).
 *
 * Implementation is "order of last write": `syncPlanFile` upserts by
 * planId, so whichever scan runs second overwrites whatever the first
 * one wrote. We just swap the visit order based on policy.
 *
 *   shared-wins (default) → per-user first, shared second
 *   local-wins            → shared first, per-user second
 *
 * Reads from kj.config.yml live; absent / malformed config falls back to
 * the safe team default. Project scope wins over global scope (same
 * precedence the rest of the config UI honours).
 */
function getSharedConflictPolicy() {
  const pluck = (cfg) => cfg?.raw?.huBoard?.sharedConflictPolicy;
  const valid = (v) => v === 'local-wins' || v === 'shared-wins';
  try {
    const projectCfg = readConfig({ scope: 'project' });
    if (valid(pluck(projectCfg))) return pluck(projectCfg);
    const globalCfg = readConfig({ scope: 'global' });
    if (valid(pluck(globalCfg))) return pluck(globalCfg);
  } catch { /* swallow — config UI handles surfacing errors */ }
  return 'shared-wins';
}

/**
 * Performs a full scan of all existing JSON files.
 */
export function fullScan() {
  const kjHome = getKjHome();
  // KJC-TSK-1347: ~/.karajan/hu-stories (the retired kj run store) is no longer
  // read; the board's HUs come from the plan backlog and the shared board.
  const sessionsDir = join(kjHome, 'sessions');

  // Clear existing data for a clean rebuild
  const db = getDb();
  db.exec('DELETE FROM context_requests');
  db.exec('DELETE FROM stories');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM projects');

  // KJC-BUG-0055: garbage-collect on-disk session artefacts whose ids carry
  // an active tombstone, or a stray one that survived a manual DB wipe would
  // come back as a ghost. (Plan dirs are NOT pre-purged here: a tombstoned
  // project may hold a newer plan from a legit projectDir re-use;
  // `syncPlanFile`'s timestamp gate decides per-file.)
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir)) {
      if (!isTombstoned('session', name)) continue;
      try { rmSync(join(sessionsDir, name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  // Scan sessions
  if (existsSync(sessionsDir)) {
    const dirs = readdirSync(sessionsDir);
    for (const dir of dirs) {
      const sessionPath = join(sessionsDir, dir, 'session.json');
      if (existsSync(sessionPath)) {
        syncSessionFile(sessionPath);
      }
    }
  }

  // KJC-PRP-0002 PR5: order plans scans by conflict policy. `syncPlanFile`
  // upserts by planId, so whichever pass runs LAST wins. Default
  // shared-wins matches what teams expect (the committed copy is canonical);
  // local-wins is the escape hatch for a solo dev still iterating before
  // publishing. Same projectDir scan, only the order changes.
  const scanPerUserPlans = () => {
    const kjDir = process.env.KJ_PLANS_DIR || join(homedir(), '.karajan', 'plans');
    const legacyKjDir = process.env.KJ_PLANS_DIR ? null : join(homedir(), '.kj', 'plans');
    for (const root of [kjDir, legacyKjDir]) {
      if (!root || !existsSync(root)) continue;
      const projectDirs = readdirSync(root);
      for (const projDir of projectDirs) {
        const projPath = join(root, projDir);
        try {
          const files = readdirSync(projPath);
          for (const file of files) {
            if (file.startsWith('plan-') && file.endsWith('.json')) {
              syncPlanFile(join(projPath, file));
            }
          }
        } catch { /* skip */ }
      }
    }
  };

  if (getSharedConflictPolicy() === 'local-wins') {
    scanSharedPlans();
    scanPerUserPlans();
  } else {
    scanPerUserPlans();
    scanSharedPlans();
  }

  console.log('[sync] Full scan completed');
}

/**
 * Scans `<projectDir>/.karajan-shared/plans/` for every known projectDir
 * and feeds each plan into `syncPlanFile`. Discovery sources:
 *   1. `process.cwd()` — covers the canonical case of running `kj board start`
 *      from a project root with a freshly cloned `.karajan-shared/` and zero
 *      local plans yet.
 *   2. `KJ_SHARED_PROJECT_DIRS` env var (colon-separated paths) — escape
 *      hatch for users running the board outside the project root or
 *      tracking several repos with one board instance.
 */
function scanSharedPlans() {
  const dirs = new Set([process.cwd()]);
  const extra = process.env.KJ_SHARED_PROJECT_DIRS;
  if (extra) {
    for (const p of extra.split(':')) if (p) dirs.add(p);
  }
  for (const projectDir of dirs) {
    const sharedDir = getSharedPlansDir(projectDir);
    if (!existsSync(sharedDir)) continue;
    try {
      const files = readdirSync(sharedDir);
      for (const file of files) {
        if (file.startsWith('plan-') && file.endsWith('.json')) {
          syncPlanFile(join(sharedDir, file));
        }
      }
    } catch { /* skip */ }
  }
}

/**
 * Starts the file watcher for live sync.
 * @returns {import('chokidar').FSWatcher}
 */
export function startWatcher() {
  const kjHome = getKjHome();
  const sessionsGlob = join(kjHome, 'sessions', '*', 'session.json');
  const promptsGlob = join(kjHome, 'prompts', '*.json');
  // Plans live under KJ_PLANS_DIR or `~/.karajan/plans/` after
  // KJC-PCS-0047 PR 3 consolidated the home directories. Without this
  // glob, HU statuses flipped to coding/done by `kj run --plan` never
  // reach the board until the user clicks 🔄 manually. The legacy
  // `~/.kj/plans/` root is also watched so users running the board
  // before their first post-upgrade `kj` command (the trigger of the
  // auto-migrator) keep seeing live updates.
  const plansRoot = process.env.KJ_PLANS_DIR || join(homedir(), '.karajan', 'plans');
  const legacyPlansRoot = process.env.KJ_PLANS_DIR ? null : join(homedir(), '.kj', 'plans');
  const plansGlob = join(plansRoot, '*', 'plan-*.json');
  const legacyPlansGlob = legacyPlansRoot ? join(legacyPlansRoot, '*', 'plan-*.json') : null;

  const watchTargets = [sessionsGlob, plansGlob, promptsGlob];
  if (legacyPlansGlob) watchTargets.push(legacyPlansGlob);
  // KJC-PRP-0002 PR2: live-watch shared plans for the board's cwd + any
  // dir listed in KJ_SHARED_PROJECT_DIRS. Without this, `kj plan share`
  // updates would only land via the next fullScan / manual 🔄.
  const sharedDirs = new Set([process.cwd()]);
  const extraShared = process.env.KJ_SHARED_PROJECT_DIRS;
  if (extraShared) {
    for (const p of extraShared.split(':')) if (p) sharedDirs.add(p);
  }
  for (const d of sharedDirs) {
    watchTargets.push(join(d, SHARED_DIR_NAME, 'plans', 'plan-*.json'));
  }
  const watcher = watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const syncByPath = (p, eventName) => {
    if (p.includes('sessions')) syncSessionFile(p);
    else if (p.includes(`${plansRoot}${plansRoot.endsWith('/') ? '' : '/'}`) || p.includes('/plans/')) {
      // Catches both per-user `~/.karajan/plans/<slug>/plan-*.json` and
      // team-shared `<projectDir>/.karajan-shared/plans/plan-*.json` — the
      // path-segment match `/plans/` is the same for both.
      syncPlanFile(p);
    } else if (p.includes('/prompts/')) {
      // Prompt files are RPC packets the runner writes when it needs
      // an answer (Solomon escalation, etc.) — see board-prompt-bridge.js.
      // The board's API exposes a /api/prompts list; here we just emit
      // a bus event so connected SSE clients pop the modal immediately
      // instead of waiting on the next render cycle.
      if (p.endsWith('.answer.json')) return;     // ignore our own writes
      try {
        const raw = readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        publishEvent({ type: 'prompt', event: eventName, promptId: data.promptId, sessionId: data.sessionId, question: data.question });
      } catch { /* malformed prompt file — ignore */ }
    }
  };

  watcher.on('add', (p) => {
    console.log(`[watcher] New file: ${p}`);
    syncByPath(p, 'add');
  });

  watcher.on('change', (p) => {
    console.log(`[watcher] Changed: ${p}`);
    syncByPath(p, 'change');
  });

  // The runner deletes prompt files once the answer arrives. Surface
  // those deletions as `prompt:resolved` events so already-open modals
  // can close themselves without polling.
  watcher.on('unlink', (p) => {
    if (p.includes('/prompts/') && p.endsWith('.json') && !p.endsWith('.answer.json')) {
      const m = /([^/]+)\.json$/.exec(p);
      if (m) publishEvent({ type: 'prompt-resolved', promptId: m[1] });
    }
  });

  console.log(`[watcher] Watching ${kjHome} + ${plansRoot} for changes`);
  return watcher;
}
