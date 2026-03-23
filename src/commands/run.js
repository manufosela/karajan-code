import { EventEmitter } from "node:events";
import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createActivityLog } from "../activity-log.js";
import { printHeader, printEvent } from "../utils/display.js";
import { resolveRole } from "../config.js";
import { parseCardId } from "../planning-game/adapter.js";

export async function runCommandHandler({ task, config, logger, flags }) {
  // Best-effort session cleanup before starting
  try {
    const { cleanupExpiredSessions } = await import("../session-cleanup.js");
    await cleanupExpiredSessions({ logger });
  } catch { /* non-blocking */ }

  const requiredProviders = [
    resolveRole(config, "coder").provider,
    config.reviewer_options?.fallback_reviewer
  ];
  if (config.pipeline?.reviewer?.enabled !== false) {
    requiredProviders.push(resolveRole(config, "reviewer").provider);
  }
  if (config.pipeline?.triage?.enabled) requiredProviders.push(resolveRole(config, "triage").provider);
  if (config.pipeline?.planner?.enabled) requiredProviders.push(resolveRole(config, "planner").provider);
  if (config.pipeline?.refactorer?.enabled) requiredProviders.push(resolveRole(config, "refactorer").provider);
  if (config.pipeline?.researcher?.enabled) requiredProviders.push(resolveRole(config, "researcher").provider);
  if (config.pipeline?.tester?.enabled) requiredProviders.push(resolveRole(config, "tester").provider);
  if (config.pipeline?.security?.enabled) requiredProviders.push(resolveRole(config, "security").provider);
  await assertAgentsAvailable(requiredProviders);

  // --- Planning Game: resolve card ID ---
  const pgCardId = flags?.pgTask || parseCardId(task);
  const pgProject = flags?.pgProject || config.planning_game?.project_id || null;

  const jsonMode = flags?.json;
  // Quiet mode is the default; --verbose disables it
  const quietMode = config.output?.quiet !== false;

  const emitter = new EventEmitter();
  let activityLog = null;

  emitter.on("progress", (event) => {
    if (!activityLog && event.sessionId) {
      activityLog = createActivityLog(event.sessionId);
      logger.onLog((entry) => activityLog.write(entry));
    }

    if (activityLog) {
      activityLog.writeEvent(event);
    }

    if (!jsonMode) {
      printEvent(event, { quiet: quietMode });
    }
  });

  if (!jsonMode) {
    printHeader({ task: task, config });
  }

  const result = await runFlow({ task: task, config, logger, flags, emitter, pgTaskId: pgCardId || null, pgProject: pgProject || null });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  }
}
