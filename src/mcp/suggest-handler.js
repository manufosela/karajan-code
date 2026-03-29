/**
 * Handler for kj_suggest MCP tool.
 * Allows the host AI to propose observations to Solomon without override power.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getSessionRoot } from "../utils/paths.js";

/**
 * Find the most recent running session for a given projectDir.
 * If projectDir is not provided, returns the most recent running session overall.
 */
async function findActiveSession(projectDir) {
  const sessionRoot = getSessionRoot();
  let entries;
  try {
    entries = await fs.readdir(sessionRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  // Walk backwards (most recent first)
  for (let i = dirs.length - 1; i >= 0; i--) {
    try {
      const raw = await fs.readFile(path.join(sessionRoot, dirs[i], "session.json"), "utf8");
      const session = JSON.parse(raw);
      if (session.status !== "running") continue;
      if (projectDir && session.projectDir && session.projectDir !== projectDir) continue;
      return session;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Handle a suggestion from the host AI.
 * Logs it to the active session's suggestions array for Solomon to evaluate.
 *
 * @param {object} params
 * @param {string} params.suggestion - The observation or proposal
 * @param {string} [params.context] - Additional context
 * @param {string} [params.projectDir] - Project directory to scope session lookup
 * @returns {Promise<object>} Result with accepted status and message
 */
export async function handleSuggestion({ suggestion, context, projectDir }) {
  if (!suggestion || typeof suggestion !== "string" || suggestion.trim() === "") {
    return {
      accepted: false,
      reason: "Suggestion text is required and must be a non-empty string."
    };
  }

  const session = await findActiveSession(projectDir);

  if (!session) {
    return {
      accepted: false,
      reason: "No active pipeline session. Suggestions are only evaluated during pipeline execution."
    };
  }

  // Initialize suggestions array if not present
  if (!Array.isArray(session.suggestions)) {
    session.suggestions = [];
  }

  const entry = {
    suggestion: suggestion.trim(),
    context: context || null,
    timestamp: new Date().toISOString()
  };

  session.suggestions.push(entry);

  // Persist the updated session
  const sessionRoot = getSessionRoot();
  const sessionFile = path.join(sessionRoot, session.id, "session.json");
  session.updated_at = new Date().toISOString();
  await fs.writeFile(sessionFile, JSON.stringify(session, null, 2), "utf8");

  return {
    accepted: true,
    status: "logged",
    sessionId: session.id,
    message: "Suggestion logged for Solomon evaluation in next iteration. Solomon will decide whether to act on it."
  };
}
