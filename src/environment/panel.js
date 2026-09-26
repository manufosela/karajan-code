/**
 * The project's panel, said out loud (KJC-TSK-0865).
 *
 * The user chooses who writes and who reviews. `kj run` honoured that choice
 * because it launched the agents itself; since v4 the HOST agent orchestrates,
 * and nothing carried the choice into the session, so the host wrote the code
 * and the user found out by accident.
 *
 * The panel line travels with the playbook, which is what every host reads at
 * session start. It ANNOUNCES, it never blocks: the host may still write the
 * code, and then it says so instead of staying quiet.
 */
import { resolveRole } from "../config/role-resolver.js";
import { policyFileHash, recordGateDecision } from "../policy/decisions.js";
import { readIdentity } from "../identity/store.js";

/** Roles worth announcing: who writes, who reviews, who arbitrates. */
export const PANEL_ROLES = ["coder", "reviewer", "solomon"];

/**
 * @returns {{coder: string|null, reviewer: string|null, solomon: string|null}}
 *   the provider declared (or inherited) for each panel role.
 */
export function resolvePanel(config) {
  const panel = {};
  for (const role of PANEL_ROLES) panel[role] = resolveRole(config, role).provider || null;
  return panel;
}

/**
 * One agent-facing line naming the panel, or null when the project declares
 * no coder and no reviewer. A project without a panel gets no line at all:
 * announcing "coder: nobody" would spend attention to say nothing.
 */
export function panelLine(config) {
  const { coder, reviewer, solomon } = resolvePanel(config);
  if (!coder && !reviewer) return null;
  const parts = [`coder=${coder || "unset"}`, `reviewer=${reviewer || "unset"}`];
  if (solomon && solomon !== coder) parts.push(`solomon=${solomon}`);
  return [
    `- The panel is your user's, not yours: ${parts.join(", ")}.`,
    "  When the coder is not you, the writing is ITS job; write it yourself",
    "  anyway and say so in your closing message, never in silence.",
  ].join("\n");
}

/**
 * KJC-TSK-0868: the host writing the code while another coder is declared is
 * not an offence to block, it is a fact to record. Announcing at session start
 * is not enough: the user chose who writes and finds out it did not happen by
 * accident, one turn at a time.
 *
 * @returns {{coder: string, host: string}|null} null when there is nothing to
 *   record: no coder declared, no host detected, or the host IS the coder.
 */
export function panelDeviation(config, host) {
  const { coder } = resolvePanel(config);
  if (!coder || !host || coder === host) return null;
  return { coder, host };
}

/**
 * KJC-TSK-0873: the log holds both sides. A deviation alone cannot say whether
 * the panel is honoured almost always or almost never, and those are different
 * situations. The compliance seat is written where the declared coder is
 * actually invoked (`kj code`); the deviation one when the turn ends.
 */
export function sealPanel({ projectDir, coder, host = null, honoured = false }) {
  const who = readIdentity(projectDir);
  return recordGateDecision(projectDir, {
    decision: honoured ? "ok" : "exempt", chokepoint: "panel", escape: null, tool: null,
    coder, host: honoured ? coder : host,
    who: who ? { gh: who.gh_user ?? null, git: who.git_email ?? null, grade: "declarada" } : null,
    policy_hash: policyFileHash(projectDir),
  });
}

/** Human-facing one-liner for `kj check` and friends. */
export function panelSummary(config) {
  const { coder, reviewer, solomon } = resolvePanel(config);
  if (!coder && !reviewer) return "panel: not declared (no coder, no reviewer)";
  const parts = [`coder ${coder || "unset"}`, `reviewer ${reviewer || "unset"}`];
  if (solomon && solomon !== coder) parts.push(`solomon ${solomon}`);
  return `panel: ${parts.join(" · ")}`;
}
