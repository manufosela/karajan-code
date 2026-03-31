/**
 * CLI status command — shows a terminal dashboard of the current pipeline state.
 */

import { readRunLog } from "../utils/run-log.js";
import { loadMostRecentSession } from "../session-store.js";
import { buildDashboard } from "../utils/status-dashboard.js";

/**
 * Run the `kj status` command: print a human-readable dashboard to stdout.
 * @param {object} options
 * @param {number} [options.lines=50] - Max log lines to read.
 * @param {string} [options.projectDir] - Project directory override.
 */
export async function statusCommand({ lines = 50, projectDir } = {}) {
  const dir = projectDir || process.cwd();
  const logResult = readRunLog(dir, lines);

  let session = null;
  try {
    session = await loadMostRecentSession();
  } catch { /* no session available */ }

  let stories = [];
  if (session) {
    try {
      const { loadHuBatch } = await import("../hu/store.js");
      const batch = await loadHuBatch(session.id);
      if (batch?.stories) stories = batch.stories;
    } catch { /* no HU batch */ }
  }

  const dashboard = buildDashboard(session, logResult.lines || [], { stories });
  console.log(dashboard);
}
