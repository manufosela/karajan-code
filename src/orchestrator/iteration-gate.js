/**
 * iteration-gate — opt-in per-iteration supervision (KJC-TSK-0628, épica
 * KJC-PCS-0062). With `--step` (or session.iteration_gate in config) the
 * pipeline pauses after EVERY iteration with a compact report — what
 * happened, what the next iteration will do, spend vs cap — and asks the
 * user: continue, stop, or continue WITH instructions. Free-text answers
 * are appended to the reviewer feedback the coder reads next iteration
 * (same channel Solomon's human guidance uses), never overwriting the
 * reviewer's own must-fix list.
 */

import { markSessionStatus } from "../session/store.js";
import { setReviewerFeedback } from "../session/mutators.js";

const STOP_ANSWERS = new Set(["stop", "parar", "para", "no", "n", "4"]);
const CONTINUE_ANSWERS = new Set(["", "s", "si", "sí", "y", "yes", "1", "continue", "continuar"]);

/** Compact human report of the iteration that just finished. */
export function buildIterationReport({ i, maxIterations, stageResults = {}, budgetTracker, maxBudgetUsd, reviewVerdict }) {
  const lines = [`Iteration ${i}/${maxIterations} finished.`];
  const stages = Object.keys(stageResults);
  if (stages.length > 0) lines.push(`Stages so far: ${stages.join(", ")}`);

  const review = reviewVerdict ?? stageResults.reviewer ?? null;
  const mustFix = review?.must_fix ?? review?.issues ?? [];
  if (review?.approved === true) {
    lines.push("Reviewer: APPROVED");
  } else if (mustFix.length > 0) {
    const shown = mustFix.slice(0, 3).map((f) => `  • ${typeof f === "string" ? f : f.title || f.description || JSON.stringify(f)}`);
    lines.push(`Reviewer: rejected with ${mustFix.length} must-fix:`, ...shown);
    if (mustFix.length > 3) lines.push(`  … and ${mustFix.length - 3} more`);
    lines.push(`Next iteration: the coder tackles those ${mustFix.length} must-fix.`);
  } else {
    lines.push("Next iteration: the coder retries against the pending feedback.");
  }

  const spent = budgetTracker?.total?.().cost_usd ?? 0;
  const cap = maxBudgetUsd != null ? ` / cap $${Number(maxBudgetUsd).toFixed(2)}` : "";
  lines.push(`Spend: $${spent.toFixed(2)}${cap}`);
  return lines.join("\n");
}

/** Append a user directive without clobbering the reviewer's feedback. */
export function appendUserDirective(session, text) {
  const existing = session.last_reviewer_feedback || "";
  const block = `## User directive (iteration gate)\n${text}`;
  setReviewerFeedback(session, existing ? `${existing}\n\n${block}` : block);
}

/**
 * Ask the user at the gate. Returns { action: "continue" | "stop",
 * injected?: string }. Disabled gate, missing askQuestion (nobody to ask)
 * or unattended autonomous runs pass straight through.
 */
export async function handleIterationGate({ enabled, askQuestion, session, logger, report }) {
  if (!enabled || !askQuestion || askQuestion.unattended === true) return { action: "continue" };

  const answer = await askQuestion(
    `${report}\n\nContinue? [Enter = yes | "stop" = stop | anything else = instructions for the next iteration]`,
  );
  const trimmed = (answer || "").trim();
  const lower = trimmed.toLowerCase();

  if (STOP_ANSWERS.has(lower)) {
    await markSessionStatus(session, "stopped");
    return { action: "stop" };
  }
  if (CONTINUE_ANSWERS.has(lower)) return { action: "continue" };

  appendUserDirective(session, trimmed);
  logger?.info?.("Iteration gate: user directive injected for the next iteration.");
  return { action: "continue", injected: trimmed };
}
