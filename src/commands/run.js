import { EventEmitter } from "node:events";
import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createActivityLog } from "../activity-log.js";
import { printHeader, printEvent } from "../utils/display.js";
import { resolveRole } from "../config.js";
import { parseCardId, buildTaskFromCard, buildCompletionUpdates } from "../planning-game/adapter.js";

export async function runCommandHandler({ task, config, logger, flags }) {
  const requiredProviders = [
    resolveRole(config, "coder").provider,
    resolveRole(config, "reviewer").provider,
    config.reviewer_options?.fallback_reviewer
  ];
  if (config.pipeline?.planner?.enabled) requiredProviders.push(resolveRole(config, "planner").provider);
  if (config.pipeline?.refactorer?.enabled) requiredProviders.push(resolveRole(config, "refactorer").provider);
  await assertAgentsAvailable(requiredProviders);

  // --- Planning Game: resolve card context ---
  const pgCardId = flags?.pgTask || parseCardId(task);
  const pgProject = flags?.pgProject || config.planning_game?.project_id || null;
  let pgCard = null;
  let enrichedTask = task;

  if (pgCardId && pgProject && config.planning_game?.enabled !== false) {
    try {
      const { fetchCard, updateCard } = await import("../planning-game/client.js");
      pgCard = await fetchCard({ projectId: pgProject, cardId: pgCardId });
      if (pgCard) {
        enrichedTask = buildTaskFromCard(pgCard);
        logger.info(`Planning Game: loaded card ${pgCardId} from project ${pgProject}`);
      }
    } catch (err) {
      logger.warn(`Planning Game: could not load card ${pgCardId}: ${err.message}`);
    }
  }

  const jsonMode = flags?.json;

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
      printEvent(event);
    }
  });

  if (!jsonMode) {
    printHeader({ task: enrichedTask, config });
  }

  const startDate = new Date().toISOString();
  const result = await runFlow({ task: enrichedTask, config, logger, flags, emitter });

  // --- Planning Game: update card on completion ---
  if (pgCard && pgProject && result?.approved) {
    try {
      const { updateCard } = await import("../planning-game/client.js");
      const updates = buildCompletionUpdates({
        approved: true,
        commits: result.git?.commits || [],
        startDate,
        codeveloper: config.planning_game?.codeveloper || null
      });
      await updateCard({ projectId: pgProject, cardId: pgCardId, firebaseId: pgCard.firebaseId, updates });
      logger.info(`Planning Game: updated ${pgCardId} to "${updates.status}"`);
    } catch (err) {
      logger.warn(`Planning Game: could not update card ${pgCardId}: ${err.message}`);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  }
}
