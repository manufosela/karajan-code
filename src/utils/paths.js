import os from "node:os";
import path from "node:path";

// Per-process vitest root. We memoise the *root* (not the suffixed
// `.karajan` / `.kj` path) so callers with different legacy defaults
// — plan-store wants `.kj`, db.js wants `.karajan` — can share one
// random tmp prefix per test run without colliding.
let _vitestRoot = null;
function vitestRoot() {
  if (_vitestRoot) return _vitestRoot;
  _vitestRoot = path.join(
    os.tmpdir(),
    `karajan-vitest-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
  );
  return _vitestRoot;
}

function vitestTmpHome(defaultSegment) {
  return path.join(vitestRoot(), defaultSegment);
}

// One-shot warning so users with KJ_HOME set in their shell rcfile do
// not get spammed once per `kj` invocation. Reset across processes,
// which is the granularity that matters for a humans-reading-stderr
// audience.
let _kjHomeWarned = false;
function emitKjHomeDeprecationWarning() {
  if (_kjHomeWarned) return;
  _kjHomeWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "\x1b[33m[warn]\x1b[0m KJ_HOME is deprecated, rename to KARAJAN_HOME (KJ_HOME will be removed in a future release)"
  );
}

/**
 * Unified resolver for Karajan's HOME-level storage root. Used by every
 * helper that previously rolled its own `getKjHome()` with subtly
 * different defaults and VITEST handling.
 *
 * Precedence (highest first):
 *   1. KARAJAN_HOME env var — explicit, no warning
 *   2. KJ_HOME env var      — explicit, prints deprecation warning once
 *   3. VITEST tmp dir       — auto-isolation under `os.tmpdir()/karajan-vitest-<pid>-<rand>/<defaultSegment>`
 *   4. `~/<defaultSegment>` — production default
 *
 * Callers pass `defaultSegment` so we can preserve `.kj` for legacy
 * paths (plan-store, standby-store) and `.karajan` for the canonical
 * root, until PR 3 unifies the defaults too.
 *
 * @param {object} [options]
 * @param {string} [options.defaultSegment=".karajan"]  HOME subdir name
 * @returns {string} absolute path
 */
export function resolveHome({ defaultSegment = ".karajan" } = {}) {
  if (process.env.KARAJAN_HOME) {
    return path.resolve(process.env.KARAJAN_HOME);
  }
  if (process.env.KJ_HOME) {
    emitKjHomeDeprecationWarning();
    return path.resolve(process.env.KJ_HOME);
  }
  if (process.env.VITEST) {
    return vitestTmpHome(defaultSegment);
  }
  return path.join(os.homedir(), defaultSegment);
}

/**
 * Canonical Karajan home (`~/.karajan` by default). Every helper that
 * used to roll its own `getKjHome()` now goes through this one — see
 * KJC-PCS-0047 PR 3 for the consolidation.
 */
export function getKarajanHome() {
  return resolveHome({ defaultSegment: ".karajan" });
}

// Test-only export. Tests that depend on observing the deprecation
// warning being emitted exactly once need to reset the latch between
// cases.
export function __resetKjHomeWarningForTests() {
  _kjHomeWarned = false;
}

export function getSessionRoot() {
  return path.join(getKarajanHome(), "sessions");
}

export function getSonarComposePath() {
  return path.join(getKarajanHome(), "docker-compose.sonar.yml");
}
