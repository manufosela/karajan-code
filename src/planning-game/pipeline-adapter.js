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

    const normalizedAnswer = (answer || "").trim().toLowerCase();
    const isAccept = normalizedAnswer === "1" || normalizedAnswer === "yes" || normalizedAnswer === "sí" || normalizedAnswer === "si";
    if (isAccept) {
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
 * Merges commits from gitResult and session.pg_commits (accumulated during pipeline).
 */
export async function markPgCardToValidate({ pgCard, pgProject, config, session, gitResult, logger }) {
  if (!pgCard || !pgProject) return;

  try {
    const { updateCard } = await import("./client.js");
    const { buildCompletionUpdates } = await import("./adapter.js");

    // Merge commits: session.pg_commits (accumulated) + gitResult.commits (final)
    const accumulatedCommits = session.pg_commits || [];
    const finalCommits = gitResult?.commits || [];
    const seenHashes = new Set(accumulatedCommits.map(c => c.hash));
    const mergedCommits = [...accumulatedCommits];
    for (const c of finalCommits) {
      if (!seenHashes.has(c.hash)) {
        mergedCommits.push(c);
      }
    }

    const pgUpdates = buildCompletionUpdates({
      approved: true,
      commits: mergedCommits,
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

/**
 * Convert a PG card's structured data into HU stories for the hu-reviewer stage.
 * Returns an array of story objects ({id, text}) or null if the card lacks structured data.
 *
 * @param {object} pgCard - The PG card object (from fetchCard)
 * @returns {Array<{id: string, text: string}>|null}
 */
export function buildHuStoriesFromPgCard(pgCard) {
  if (!pgCard?.descriptionStructured?.length) return null;

  const parts = [];

  // User stories (Como/Quiero/Para → As/I want/So that)
  for (const s of pgCard.descriptionStructured) {
    parts.push(`As ${s.role}, I want ${s.goal}, so that ${s.benefit}.`);
  }

  // Acceptance criteria
  if (pgCard.acceptanceCriteriaStructured?.length) {
    parts.push("", "Acceptance Criteria:");
    for (const ac of pgCard.acceptanceCriteriaStructured) {
      if (ac.given && ac.when && ac.then) {
        parts.push(`- Given ${ac.given}, When ${ac.when}, Then ${ac.then}`);
      } else if (ac.raw) {
        parts.push(`- ${ac.raw}`);
      }
    }
  } else if (pgCard.acceptanceCriteria) {
    parts.push("", "Acceptance Criteria:", pgCard.acceptanceCriteria);
  }

  const storyId = pgCard.cardId || "HU-PG-001";
  const storyText = parts.join("\n");

  return [{ id: storyId, text: storyText }];
}

/**
 * Accumulate a commit into the session's pg_commits array.
 * Called after each successful commitAll during the iteration loop.
 * Best-effort: never throws.
 *
 * @param {object} session - Pipeline session (mutated)
 * @param {{ hash: string, message: string, date?: string, author?: string }} commitInfo
 */
export function accumulateCommit(session, commitInfo) {
  if (!session || !commitInfo?.hash) return;
  if (!session.pg_commits) session.pg_commits = [];
  session.pg_commits.push({
    hash: commitInfo.hash,
    message: commitInfo.message || "",
    date: commitInfo.date || new Date().toISOString(),
    author: commitInfo.author || "BecarIA"
  });
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
