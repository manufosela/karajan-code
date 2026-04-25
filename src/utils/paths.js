import os from "node:os";
import path from "node:path";

// Per-process tmp dir for VITEST runs that forget to set KJ_HOME. Same
// rationale as src/plan/plan-store.js — without this, tests that use
// real session/board paths leak files into the developer's real
// `~/.karajan/` and pollute the HU Board's SQLite DB. Memoised so
// every helper in the same process agrees on the path. The trailing
// segment is `.karajan` to keep semantic parity with non-VITEST
// defaults (existing tests assert paths contain ".karajan/...").
let _vitestKarajanHome = null;
function vitestTmpKarajanHome() {
  if (_vitestKarajanHome) return _vitestKarajanHome;
  _vitestKarajanHome = path.join(
    os.tmpdir(),
    `karajan-vitest-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    ".karajan"
  );
  return _vitestKarajanHome;
}

export function getKarajanHome() {
  if (process.env.KJ_HOME) {
    return path.resolve(process.env.KJ_HOME);
  }
  if (process.env.VITEST) {
    return vitestTmpKarajanHome();
  }
  return path.join(os.homedir(), ".karajan");
}

export function getSessionRoot() {
  return path.join(getKarajanHome(), "sessions");
}

export function getSonarComposePath() {
  return path.join(getKarajanHome(), "docker-compose.sonar.yml");
}
