/**
 * Vitest globalSetup — runs ONCE per `npm test` invocation (not per file,
 * not per fork). Used to purge stale `karajan-vitest-*` tmp dirs left
 * behind by SIGKILL'd, crashed, or hard-aborted forks from previous
 * runs.
 *
 * Why a separate mtime sweep on top of the per-process `process.on("exit")`
 * cleanup in src/utils/paths.js + packages/hu-board/src/db.js:
 *
 * - `process.on("exit")` fires only on graceful Node exits. SIGKILL,
 *   OOM-killed forks, debugger detaches, and `--bail` cancellations
 *   skip it entirely. Without a safety net these tmp dirs leak forever
 *   — which is exactly what produced the 10 762 stale dirs that
 *   triggered KJC-BUG-0075.
 *
 * - Sweeping at globalSetup (i.e. before any worker forks) avoids races
 *   with live test runs — anything older than 24 h cannot belong to
 *   the run that is about to start.
 *
 * Best-effort: failures are swallowed. We never want test infra to
 * crash a CI job over a tmp-cleanup hiccup.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

export default function setup() {
  const root = os.tmpdir();
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of entries) {
    if (!name.startsWith("karajan-vitest-")) continue;
    const full = path.join(root, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // best-effort
    }
  }
}
