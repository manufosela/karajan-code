/**
 * Planning Game pipeline adapter.
 * Subscribes to pipeline events and handles PG card lifecycle updates.
 * Decouples PG logic from the orchestrator — works as an event-driven plugin.
 *
 * Handles:
 * - Marking card as "In Progress" at session start
 * - Decomposing tasks into subtasks after triage
 * - Marking card as "To Validate" on approved completion
 *
 * If PG is disabled or no pgTaskId is present, the adapter does nothing.
 */

import { emitProgress, makeEvent } from "../utils/events.js";
import { addCheckpoint, saveSession } from "../session-store.js";

/**
 * Attach the PG adapter to a pipeline emitter.
 * Call this once during runFlow() initialization.
 *
 * @param {object} opts
 * @param {EventEmitter} opts.emitter - Pipeline event emitter
 * @param {object} opts.session - Session object (mutated during pipeline)
 * @param {object} opts.config - Resolved config
 * @param {object} opts.logger - Logger instance
 * @param {string|null} opts.pgTaskId - Planning Game card ID (e.g. "KJC-TSK-0099")
 * @param {string|null} opts.pgProject - Planning Game project ID
 * @returns {{ pgCard: object|null }} The fetched PG card (or null)
 */
export async function initPgAdapter({ session, config, logger, pgTaskId, pgProject }) {
  if (!pgTaskId || !pgProject || config.planning_game?.enabled === false) {
    return { pgCard: null };
  }

  const pgCard = await markPgCardInProgress({ pgTaskId, pgProject, config, logger });
  return { pgCard };
}

/**
 * Handle PG task decomposition after triage.
 * Creates subtask cards in PG when triage recommends decomposition.
 */
export async function handlePgDecomposition({ triageResult, pgTaskId, pgProject, config, askQuestion, emitter, eventBase, session, stageResults, logger }) {
  const shouldDecompose = triageResult.stageResult?.shouldDecompose
    && triageResult.stageResult.subtasks?.length > 1
    && pgTaskId
    && pgProject
    && config.planning_game?.enabled !== false
    && askQuestion;

  if (!shouldDecompose) return;

  try {
    const { buildDecompositionQuestion, createDecompositionSubtasks } = await import("./decomposition.js");
    const { createCard, relateCards, fetchCard } = await import("./client.js");

    const question = buildDecompositionQuestion(triageResult.stageResult.subtasks, pgTaskId);
    const answer = await askQuestion(question);

    if (answer && (answer.trim().toLowerCase() === "yes" || answer.trim().toLowerCase() === "sí" || answer.trim().toLowerCase() === "si")) {
      const parentCard = await fetchCard({ projectId: pgProject, cardId: pgTaskId }).catch(() => null);
      const createdSubtasks = await createDecompositionSubtasks({
        client: { createCard, relateCards },
        projectId: pgProject,
        parentCardId: pgTaskId,
        parentFirebaseId: parentCard?.firebaseId || null,
        subtasks: triageResult.stageResult.subtasks,
        epic: parentCard?.epic || null,
        sprint: parentCard?.sprint || null,
        codeveloper: config.planning_game?.codeveloper || null
      });

      stageResults.triage.pgSubtasks = createdSubtasks;
      logger.info(`Planning Game: created ${createdSubtasks.length} subtasks from decomposition`);

      emitProgress(
        emitter,
        makeEvent("pg:decompose", { ...eventBase, stage: "triage" }, {
          message: `Created ${createdSubtasks.length} subtasks in Planning Game`,
          detail: { subtasks: createdSubtasks.map((s) => ({ cardId: s.cardId, title: s.title })) }
        })
      );

      await addCheckpoint(session, {
        stage: "pg-decompose",
        subtasksCreated: createdSubtasks.length,
        cardIds: createdSubtasks.map((s) => s.cardId)
      });
    }
  } catch (err) {
    logger.warn(`Planning Game decomposition failed: ${err.message}`);
  }
}

/**
 * Mark PG card as "To Validate" on approved session completion.
 */
export async function markPgCardToValidate({ pgCard, pgProject, config, session, gitResult, logger }) {
  if (!pgCard || !pgProject) return;

  try {
    const { updateCard } = await import("./client.js");
    const { buildCompletionUpdates } = await import("./adapter.js");
    const pgUpdates = buildCompletionUpdates({
      approved: true,
      commits: gitResult?.commits || [],
      startDate: session.pg_card?.startDate || session.created_at,
      codeveloper: config.planning_game?.codeveloper || null
    });
    await updateCard({
      projectId: pgProject,
      cardId: session.pg_task_id,
      firebaseId: pgCard.firebaseId,
      updates: pgUpdates
    });
    logger.info(`Planning Game: ${session.pg_task_id} → To Validate`);
  } catch (err) {
    logger.warn(`Planning Game: could not update ${session.pg_task_id} on completion: ${err.message}`);
  }
}

// --- Internal helpers ---

async function markPgCardInProgress({ pgTaskId, pgProject, config, logger }) {
  try {
    const { fetchCard, updateCard } = await import("./client.js");
    const pgCard = await fetchCard({ projectId: pgProject, cardId: pgTaskId });
    if (pgCard && pgCard.status !== "In Progress") {
      await updateCard({
        projectId: pgProject,
        cardId: pgTaskId,
        firebaseId: pgCard.firebaseId,
        updates: {
          status: "In Progress",
          startDate: new Date().toISOString(),
          developer: "dev_016",
          codeveloper: config.planning_game?.codeveloper || null
        }
      });
      logger.info(`Planning Game: ${pgTaskId} → In Progress`);
    }
    return pgCard;
  } catch (err) {
    logger.warn(`Planning Game: could not update ${pgTaskId}: ${err.message}`);
    return null;
  }
}
