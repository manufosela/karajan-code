/**
 * Build a human-readable `decisions.md` journal file summarizing every
 * Solomon ruling and Brain decision made during a session.
 *
 * Acceptance criterion (KJC-TSK-0287):
 *   - Given Solomon was invoked at least once → decisions.md is written with
 *     timestamp, trigger, conflict context, ruling (action + reasoning),
 *     and resulting actions for every invocation.
 *   - Given Solomon was NOT invoked → decisions.md is NOT created.
 *
 * Brain routing decisions (from KJC-TSK-0322) are appended as a secondary
 * section when present, since they share the same "decisions" semantics.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getSessionRoot } from "../../utils/paths.js";

/**
 * @typedef {Object} SolomonRuling
 * @property {string} at                         - ISO timestamp
 * @property {string} stage                      - conflict stage (reviewer, brain-routing, ...)
 * @property {string} trigger                    - short reason the invocation was triggered
 * @property {Object} conflict                   - conflict context (task, reason, summary)
 * @property {string} ruling                     - approve / continue / escalate_human / create_subtask / ...
 * @property {string} [reasoning]
 * @property {string[]} [conditions]
 * @property {string} [alternativeAgent]
 * @property {string} [result]                   - what the orchestrator did with the ruling
 */

/**
 * @typedef {Object} BrainDecisionRecord
 * @property {number} seq
 * @property {string} at
 * @property {string} intent
 * @property {string[]} rolesOn
 * @property {string} confidence
 * @property {string} rationale
 * @property {string[]} appliedOverrides
 */

function esc(text) {
  return String(text ?? "").replaceAll(/\|/g, "\\|");
}

function formatConditions(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return "—";
  return conditions.map((c) => `- ${esc(c)}`).join("\n");
}

function formatConflict(conflict) {
  if (!conflict) return "—";
  const parts = [];
  if (conflict.task) parts.push(`**Task**: ${esc(conflict.task.slice(0, 200))}${conflict.task.length > 200 ? "…" : ""}`);
  if (conflict.reason) parts.push(`**Reason**: ${esc(conflict.reason)}`);
  if (conflict.summary) parts.push(`**Summary**: ${esc(conflict.summary)}`);
  return parts.length > 0 ? parts.join("\n") : "—";
}

/**
 * Render a Solomon ruling as a Markdown subsection.
 * @param {SolomonRuling} ruling
 * @param {number} index
 * @returns {string}
 */
function renderRuling(ruling, index) {
  const at = ruling.at || "(unknown timestamp)";
  const header = `### ${index + 1}. Solomon @ ${at} — ${esc(ruling.ruling || "unknown")}`;
  const lines = [
    header,
    "",
    `- **Stage**: ${esc(ruling.stage || "?")}`,
    `- **Trigger**: ${esc(ruling.trigger || "?")}`,
    `- **Ruling**: \`${esc(ruling.ruling || "?")}\``,
  ];
  if (ruling.alternativeAgent) lines.push(`- **Alternative agent**: ${esc(ruling.alternativeAgent)}`);
  if (ruling.result) lines.push(`- **Applied result**: ${esc(ruling.result)}`);
  lines.push("");
  if (ruling.reasoning) {
    lines.push("**Reasoning:**", "");
    lines.push(ruling.reasoning.trim(), "");
  }
  if (ruling.conditions?.length) {
    lines.push("**Conditions:**", "");
    lines.push(formatConditions(ruling.conditions), "");
  }
  lines.push("**Conflict context:**", "");
  lines.push(formatConflict(ruling.conflict), "");
  return lines.join("\n");
}

function renderBrainDecision(decision, index) {
  return [
    `### ${index + 1}. Brain @ ${decision.at} — ${esc(decision.intent)}`,
    "",
    `- **Confidence**: ${esc(decision.confidence)}`,
    `- **Roles on**: ${(decision.rolesOn || []).map(esc).join(", ") || "—"}`,
    `- **Overrides applied**: ${(decision.appliedOverrides || []).map(esc).join(", ") || "—"}`,
    "",
    `> ${esc(decision.rationale || "")}`,
    "",
  ].join("\n");
}

/**
 * Build the Markdown content for a session. Returns `null` if no Solomon
 * rulings are present (per acceptance criteria — no Solomon, no file).
 *
 * @param {Object} session
 * @returns {string|null}
 */
export function buildDecisionsMarkdown(session) {
  const rulings = Array.isArray(session?.solomonRulings) ? session.solomonRulings : [];
  const brainDecisions = Array.isArray(session?.brainDecisions) ? session.brainDecisions : [];

  // AC: no Solomon invocation → do not generate the file.
  if (rulings.length === 0) return null;

  const sessionId = session?.id || "(unknown)";
  const header = [
    `# Session decisions — ${sessionId}`,
    "",
    `_Generated at ${new Date().toISOString()}._`,
    "",
    `This journal records every decision the pipeline delegated to Solomon, plus Brain routing decisions for cross-reference.`,
    "",
    "## Summary",
    "",
    `- Solomon invocations: **${rulings.length}**`,
    `- Brain routing decisions: **${brainDecisions.length}**`,
    "",
    "---",
    "",
    "## Solomon rulings",
    "",
  ].join("\n");

  const solomonSection = rulings.map((r, i) => renderRuling(r, i)).join("\n---\n\n");

  const brainSection = brainDecisions.length > 0
    ? "\n---\n\n## Brain routing decisions\n\n" + brainDecisions.map((d, i) => renderBrainDecision(d, i)).join("\n")
    : "";

  return header + solomonSection + brainSection + "\n";
}

/**
 * Persist decisions.md to the session's journal directory. No-op when there
 * are no Solomon rulings (per acceptance criteria).
 *
 * Path resolution (first match wins):
 *   1. options.journalDir       — direct path to the session journal directory
 *   2. options.sessionRoot + id — combines with session.id
 *   3. getSessionRoot() + id    — default Karajan session root
 *
 * @param {Object} session
 * @param {{ journalDir?: string, sessionRoot?: string, logger?: Object }} [options]
 * @returns {Promise<{ written: boolean, path: string|null }>}
 */
export async function writeDecisionsJournal(session, options = {}) {
  const content = buildDecisionsMarkdown(session);
  if (content === null) return { written: false, path: null };

  const sessionDir = options.journalDir
    || path.join(options.sessionRoot || getSessionRoot(), session.id);
  const filePath = path.join(sessionDir, "decisions.md");
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    options.logger?.info?.(`Wrote decisions journal: ${filePath}`);
    return { written: true, path: filePath };
  } catch (err) {
    options.logger?.warn?.(`Failed to write decisions journal (non-blocking): ${err.message}`);
    return { written: false, path: null };
  }
}

/**
 * Append a Solomon ruling to session.solomonRulings. Creates the array if
 * absent. Callers (invokeSolomon) pass the structured record.
 *
 * @param {Object} session
 * @param {SolomonRuling} record
 */
export function recordSolomonRuling(session, record) {
  if (!session) return;
  if (!Array.isArray(session.solomonRulings)) session.solomonRulings = [];
  session.solomonRulings.push({
    at: record.at || new Date().toISOString(),
    stage: record.stage || "unknown",
    trigger: record.trigger || "",
    conflict: record.conflict || {},
    ruling: record.ruling || "unknown",
    reasoning: record.reasoning || "",
    conditions: Array.isArray(record.conditions) ? [...record.conditions] : [],
    alternativeAgent: record.alternativeAgent || null,
    result: record.result || "",
  });
}
