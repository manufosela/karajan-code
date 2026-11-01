// KJC-TSK-0542: where the board keeps its files (karajan home, plans, run logs).
// Re-exported by db.js, so callers keep importing from there.
import { join, dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Per-process tmp dir for VITEST runs that forget to set KJ_HOME.
// Without this, a test that touches initDb() / upsertProject() drops
// rows into the developer's real `~/.karajan/hu-board.db` and the
// running board UI shows phantom projects (observed: "sess-1",
// "default", "Karajan Code" with 49 test fixture plans). Memoise so
// every consumer in the same process agrees on the path. The
// trailing `.karajan` segment keeps semantic parity with non-VITEST
// defaults so any caller assuming the path ends in `.karajan` still
// works.
let _vitestKjHome = null;
function vitestTmpKjHome() {
  if (_vitestKjHome) return _vitestKjHome;
  _vitestKjHome = join(
    tmpdir(),
    `karajan-vitest-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    '.karajan'
  );
  // KJC-BUG-0075: clean up on clean exit so /tmp doesn't accumulate one
  // dir per fork × run. We rm the *parent* (the `karajan-vitest-<pid>-<rand>`
  // wrapper), not the `.karajan` segment, so the whole tmp tree goes.
  // Only fires on graceful exit; SIGKILL leaks are caught by the
  // global-setup mtime purge at the start of the next run.
  const parent = dirname(_vitestKjHome);
  process.on('exit', () => {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch {
      // best-effort: never crash a test process on cleanup failure
    }
  });
  return _vitestKjHome;
}

/**
 * Returns the KJ home directory, respecting KJ_HOME env var.
 * Under VITEST without KJ_HOME, returns a per-process tmp dir to
 * prevent accidental writes into the developer's real `~/.karajan/`.
 * @returns {string}
 */
export function getKjHome() {
  // KJC-TSK-0420: same precedence chain as src/utils/paths.js::resolveHome():
  // KARAJAN_HOME (canonical) > KJ_HOME (legacy) > VITEST tmp > ~/.karajan.
  // Kept inline rather than cross-workspace imported so the hu-board package
  // does not gain a new src/ dep; the precedence behaviour is the same.
  if (process.env.KARAJAN_HOME) return process.env.KARAJAN_HOME;
  if (process.env.KJ_HOME) return process.env.KJ_HOME;
  if (process.env.VITEST) return vitestTmpKjHome();
  return join(process.env.HOME || '/root', '.karajan');
}

/**
 * Canonical path to the HU Board's run-logs directory
 * (`<karajan-home>/hu-board-runs/`). Centralised here so the four
 * board callers (plan-mutations, command-runner, api.js GET routes
 * for plan + commandId logs) and the garbage-collector all agree on
 * the same string — KJC-TSK-0421.
 *
 * @returns {string}
 */
export function getHuBoardRunsDir() {
  return join(getKjHome(), 'hu-board-runs');
}

/**
 * Canonical path to the plans directory the board scans
 * (`<karajan-home>/plans/`). Respects `KJ_PLANS_DIR` as an absolute
 * override, mirroring sync.js. KJC-BUG-0059 (v2.19.3): preflight
 * endpoint used a hard-coded `~/.kj/plans/` legacy fallback that
 * survived the v2.19.0 consolidation, causing the board to report
 * "directorio del proyecto: no detectado" even when the plan on disk
 * had a valid `projectDir`.
 *
 * @returns {string}
 */
export function getHuBoardPlansDir() {
  return process.env.KJ_PLANS_DIR || join(getKjHome(), 'plans');
}

/**
 * Legacy `~/.kj/plans/` directory — only returned when KJ_PLANS_DIR
 * is unset (it would be the same path anyway when overridden).
 * Callers iterate canonical + legacy so users who have not yet run
 * the v2.19.0 auto-migrator still see their plans. KJC-BUG-0059.
 *
 * @returns {string|null}
 */
export function getHuBoardLegacyPlansDir() {
  if (process.env.KJ_PLANS_DIR) return null;
  return join(process.env.HOME || '/root', '.kj', 'plans');
}

/**
 * Ordered list of every plans root the board should scan: canonical
 * first (`~/.karajan/plans/`), legacy second when applicable
 * (`~/.kj/plans/`). Honours `KJ_PLANS_DIR` as a single override,
 * matching `sync.js`'s fullScan / startWatcher precedence so the
 * preflight, plans-outcome, delete-project and delete-plan endpoints
 * see the same set of files the watcher sees. KJC-BUG-0059.
 *
 * @returns {string[]}
 */
export function getHuBoardPlansDirs() {
  const dirs = [getHuBoardPlansDir()];
  const legacy = getHuBoardLegacyPlansDir();
  if (legacy) dirs.push(legacy);
  return dirs;
}
