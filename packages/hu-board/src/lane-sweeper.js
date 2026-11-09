/**
 * KJC-TSK-1479 (owner, 9-nov: "no podemos acumular carriles"): the daemon retires the abandoned
 * lanes of every project it knows, at start and every hour. The judgment is kj worktree prune's
 * (merged, clean, nobody inside, governance record archived); the sweeper only runs it, one
 * project at a time, and never two sweeps at once.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getProjects } from './db.js';
import { projectDirForSlug } from './project-dir.js';
import { canonicalProjectDir } from './sync-project.js';
import { KJ_CLI } from './command-runner.js';

export const SWEEP_EVERY_MS = 60 * 60 * 1000;
const PRUNE_TIMEOUT_MS = 5 * 60 * 1000;

const runPrune = (dir) => promisify(execFile)(process.execPath, [KJ_CLI, 'worktree', 'prune'], { cwd: dir, timeout: PRUNE_TIMEOUT_MS });

/** The main checkout of every real project with kj lanes, each once (a project may be known by a lane). */
export function sweepTargets({ projects = getProjects(), dirOf = projectDirForSlug, canonical = canonicalProjectDir } = {}) {
  const dirs = projects.filter((p) => !p.is_test).map((p) => dirOf(p.id)).filter(Boolean).map((d) => canonical(d));
  return [...new Set(dirs)].filter((d) => existsSync(join(d, '.kj', 'worktrees')));
}

/** Prunes each target in turn; a failing project is logged and the sweep goes on. */
export async function sweepLanes({ targets = sweepTargets(), prune = runPrune, log = console } = {}) {
  for (const dir of targets) {
    try {
      const { stdout } = await prune(dir);
      for (const line of stdout.split('\n').filter((l) => l.startsWith('✓'))) log.log(`[lane-sweeper] ${dir}: ${line}`);
    } catch (err) {
      log.warn(`[lane-sweeper] ${dir}: ${err.message}`);
    }
  }
}

/** Sweeps now and every `everyMs`; a tick while a sweep runs is skipped. Returns the stop. */
export function startLaneSweeper({ sweep = sweepLanes, everyMs = SWEEP_EVERY_MS, log = console } = {}) {
  let running = null;
  const tick = () => {
    running ??= (async () => sweep())().catch((err) => log.warn(`[lane-sweeper] skipped: ${err.message}`)).finally(() => { running = null; });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
