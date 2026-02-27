/**
 * Planning Game MCP adapter.
 * Handles card ID detection, task enrichment, and completion updates.
 */

const CARD_ID_PATTERN = /[A-Z0-9]{2,5}-(?:TSK|BUG|PCS|PRP|SPR|QA)-\d{4}/;

export function parseCardId(text) {
  if (!text) return null;
  const match = String(text).match(CARD_ID_PATTERN);
  return match ? match[0] : null;
}

export function buildTaskFromCard(card) {
  const parts = [`## ${card.cardId}: ${card.title}`];

  if (card.descriptionStructured?.length) {
    parts.push("", "### User Story");
    for (const s of card.descriptionStructured) {
      parts.push(`- **Como** ${s.role}`);
      parts.push(`  **Quiero** ${s.goal}`);
      parts.push(`  **Para** ${s.benefit}`);
    }
  } else if (card.description) {
    parts.push("", "### Description", card.description);
  }

  if (card.acceptanceCriteriaStructured?.length) {
    parts.push("", "### Acceptance Criteria");
    for (const ac of card.acceptanceCriteriaStructured) {
      if (ac.given && ac.when && ac.then) {
        parts.push(`- **Given** ${ac.given}`);
        parts.push(`  **When** ${ac.when}`);
        parts.push(`  **Then** ${ac.then}`);
      } else if (ac.raw) {
        parts.push(`- ${ac.raw}`);
      }
    }
  } else if (card.acceptanceCriteria) {
    parts.push("", "### Acceptance Criteria", card.acceptanceCriteria);
  }

  if (card.implementationPlan) {
    const plan = card.implementationPlan;
    parts.push("", "### Implementation Plan");
    if (plan.approach) parts.push(`**Approach:** ${plan.approach}`);
    if (plan.steps?.length) {
      parts.push("**Steps:**");
      for (const step of plan.steps) {
        parts.push(`1. ${step.description}`);
      }
    }
  }

  return parts.join("\n");
}

export function buildCommitsPayload(gitLog) {
  if (!gitLog || !gitLog.length) return [];
  return gitLog.map((entry) => ({
    hash: entry.hash,
    message: entry.message,
    date: entry.date,
    author: entry.author
  }));
}

export function buildCompletionUpdates({ approved, commits, startDate, codeveloper }) {
  if (!approved) return {};

  const updates = {
    status: "To Validate",
    endDate: new Date().toISOString(),
    developer: "dev_016",
    commits: commits || []
  };

  if (startDate) updates.startDate = startDate;
  if (codeveloper) updates.codeveloper = codeveloper;

  return updates;
}

export function buildTaskPrompt({ task, card }) {
  const cardId = parseCardId(task) || card?.cardId || null;
  const prompt = card ? buildTaskFromCard(card) : task;
  return { cardId, prompt };
}

export async function updateCardOnCompletion({
  client,
  projectId,
  cardId,
  firebaseId,
  approved,
  gitLog,
  startDate,
  codeveloper
}) {
  if (!approved) return null;

  const commits = buildCommitsPayload(gitLog);
  const updates = buildCompletionUpdates({ approved, commits, startDate, codeveloper });
  return client.updateCard({ projectId, cardId, firebaseId, updates });
}
