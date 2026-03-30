/**
 * Planning Game decomposition.
 * Creates subtask cards in PG with blocks/blockedBy chain when triage
 * recommends decomposition and user accepts.
 */

import { msg } from "../utils/messages.js";

export async function createDecompositionSubtasks({
  client,
  projectId,
  parentCardId,
  parentFirebaseId,
  subtasks,
  epic,
  sprint,
  codeveloper
}) {
  if (!subtasks?.length || subtasks.length < 2) return [];

  const created = [];

  for (let i = 0; i < subtasks.length; i++) {
    const card = {
      type: "task",
      title: subtasks[i],
      descriptionStructured: [{
        role: "developer",
        goal: subtasks[i],
        benefit: `Part ${i + 1}/${subtasks.length} of decomposed task ${parentCardId}`
      }],
      acceptanceCriteria: `Subtask ${i + 1} of ${parentCardId}: ${subtasks[i]}`
    };

    if (epic) card.epic = epic;
    if (sprint) card.sprint = sprint;
    if (codeveloper) card.codeveloper = codeveloper;

    const result = await client.createCard({ projectId, card });
    created.push({
      cardId: result.cardId,
      firebaseId: result.firebaseId,
      title: subtasks[i],
      index: i
    });
  }

  // Chain blocks/blockedBy relationships: card[0] blocks card[1], card[1] blocks card[2], etc.
  for (let i = 0; i < created.length - 1; i++) {
    await client.relateCards({
      projectId,
      sourceCardId: created[i].cardId,
      targetCardId: created[i + 1].cardId,
      relationType: "blocks"
    });
  }

  // Relate all subtasks to parent
  for (const sub of created) {
    await client.relateCards({
      projectId,
      sourceCardId: parentCardId,
      targetCardId: sub.cardId,
      relationType: "related"
    });
  }

  return created;
}

export function buildDecompositionQuestion(subtasks, parentCardId, lang = "en") {
  const lines = [
    msg("triage_decompose", lang, { count: subtasks.length }),
    ""
  ];
  for (let i = 0; i < subtasks.length; i++) {
    lines.push(`${i + 1}. ${subtasks[i]}`);
  }
  lines.push(
    "",
    msg("triage_create_cards", lang, { cardId: parentCardId }),
    msg("triage_sequential", lang),
    "",
    msg("triage_reply", lang)
  );
  return lines.join("\n");
}
