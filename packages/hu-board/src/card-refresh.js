/**
 * KJC-TSK-1587: a card closed by its merge (the issue closed by its pull request) leaves no line
 * in the card trace, and the stage kept it in progress on its desk. The board lists the shared
 * board of each project every ten minutes (`kj hu list`, which writes its cache in the main
 * checkout), so stage-board-cache.js reads a fresh status. Set KJ_CARD_REFRESH=off to list nothing.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { KJ_CLI } from './command-runner.js';
import { sweepTargets } from './lane-sweeper.js';

export const REFRESH_EVERY_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 60 * 1000;

const listBoard = (cwd) => promisify(execFile)(process.execPath, [KJ_CLI, 'hu', 'list'], { cwd, timeout: LIST_TIMEOUT_MS });

/** Lists the board of each project in `dirs`, one after the other; a failure is logged, never thrown. */
export async function refreshCards(dirs, { run = listBoard, log = console } = {}) {
  for (const dir of dirs) {
    try {
      await run(dir);
    } catch (err) {
      log.warn(`[card-refresh] ${dir}: ${err.message}`);
    }
  }
}

/** Refreshes every project now and every `everyMs`, never two at once. Returns the stop. */
export function startCardRefresh({ targets = sweepTargets, refresh = refreshCards, everyMs = REFRESH_EVERY_MS, log = console, env = process.env } = {}) {
  if (env.KJ_CARD_REFRESH === 'off') return () => {};
  let running = null;
  const tick = () => {
    running ??= (async () => refresh(targets(), { log }))()
      .catch((err) => log.warn(`[card-refresh] skipped: ${err.message}`)).finally(() => { running = null; });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
