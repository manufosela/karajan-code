import { SolomonRole } from "../roles/solomon-role.js";
import { addCheckpoint, pauseSession, saveSession } from "../session/store.js";
import { setSuggestions } from "../session/mutators.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { msg, getLang } from "../utils/messages.js";

/**
 * @typedef {import("../types/solomon.js").Conflict} Conflict
 * @typedef {import("../types/solomon.js").SolomonResult} SolomonResult
 */

/**
 * Architectural invariant (DO NOT BREAK):
 * `invokeSolomon` MUST NOT be called directly from stages, rules or agent
 * code. The only callers should be:
 *   - Karajan Brain (via `src/brain/solomon-consult.js`)
 *   - The orchestrator's escalation path (`src/orchestrator/flow-runner.js`)
 *     on behalf of Brain.
 * The v2.3.0 audit fixed 21 violations of this rule. Keeping Solomon behind
 * Brain is what the "Brain-as-gateway, Solomon-as-judge" architecture
 * depends on — see docs/ARCHITECTURE.md §Brain/Solomon.
 */

/**
 * Build a human-readable escalation message from raw Solomon conflict data.
 * Replaces the raw JSON dump with structured, plain-text output.
 *
 * @param {object} solomonResult - The conflict object passed to escalateToHuman
 * @param {object} [session]     - Current session (optional, used for extra context)
 * @returns {string} Formatted message suitable for display to the user
 */
export function formatEscalationMessage(solomonResult, session) {
  const stage = solomonResult?.stage || "unknown";
  const solomonReason = solomonResult?.solomonReason || null;
  const history = solomonResult?.history || [];
  const lang = getLang(session?.config_snapshot);

  const lines = [];
  lines.push(msg("solomon_conflict", lang, { stage }));
  lines.push("");

  // Extract reviewer/agent feedback from history
  const feedbackEntries = history.filter(entry => entry && typeof entry === "object");
  if (feedbackEntries.length > 0) {
    lines.push(msg("solomon_feedback", lang));
    for (const entry of feedbackEntries) {
      const agent = entry.agent || "unknown";
      const feedback = entry.feedback || "No feedback provided";
      // Split multi-line feedback (e.g. "R-1: ...\nR-2: ...") into bullet points
      const feedbackLines = String(feedback).split("\n").filter(l => l.trim());
      if (feedbackLines.length === 1) {
        lines.push(`  [${agent}] ${feedbackLines[0]}`);
      } else {
        lines.push(`  [${agent}]`);
        for (const fl of feedbackLines) {
          lines.push(`    - ${fl}`);
        }
      }
    }
    lines.push("");
  }

  // Solomon's reason (if it tried and failed)
  if (solomonReason) {
    lines.push(`${msg("solomon_reason", lang)} ${solomonReason}`);
    lines.push("");
  }

  // Iteration context
  const iterationCount = solomonResult?.iterationCount;
  const maxIterations = solomonResult?.maxIterations;
  if (iterationCount !== undefined && maxIterations !== undefined) {
    lines.push(msg("pipeline_iteration", lang, { current: iterationCount, max: maxIterations }));
    lines.push("");
  }

  lines.push(msg("solomon_options", lang));
  lines.push("");
  lines.push(msg("solomon_proceed", lang));

  return lines.join("\n");
}

/**
 * Extract Solomon's previous rulings from session checkpoints.
 * Gives Solomon memory of its own decisions to avoid repeating failed strategies.
 */
function extractSolomonHistory(session) {
  const checkpoints = session?.checkpoints || [];
  return checkpoints
    .filter(cp => cp.stage === "solomon")
    .map(cp => ({
      conflictStage: cp.conflictStage,
      ruling: cp.ruling,
      alternativeAgent: cp.alternativeAgent,
      waitUntil: cp.waitUntil,
      conditions: cp.conditions,
      error: cp.error || null
    }));
}

/**
 * Consult Solomon (or fall back to human escalation) for a given conflict.
 * See the Conflict typedef for the shape of the `conflict` argument and
 * the invariant above for who is allowed to call this.
 *
 * @param {Object}    params
 * @param {Object}    params.config
 * @param {Object}    params.logger
 * @param {Object}    [params.emitter]
 * @param {Object}    [params.eventBase]
 * @param {string}    params.stage
 * @param {Conflict}  params.conflict
 * @param {Function}  [params.askQuestion]
 * @param {Object}    [params.session]
 * @param {number}    [params.iteration]
 * @returns {Promise<SolomonResult>}
 */
export async function invokeSolomon({ config, logger, emitter, eventBase, stage, conflict, askQuestion, session, iteration }) {
  const solomonEnabled = Boolean(config.pipeline?.solomon?.enabled);

  if (!solomonEnabled) {
    return escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration });
  }

  // KJC-BUG-0113: the fallback used to be "gemini" — Google retired the
  // Gemini Code Assist CLI for individuals (IneligibleTierError), so an
  // unconfigured Solomon died on every escalation. Claude matches the
  // brain.provider default.
  const solomonProvider = config?.roles?.solomon?.provider || "claude";
  emitProgress(
    emitter,
    makeEvent("solomon:start", { ...eventBase, stage: "solomon" }, {
      message: `Solomon arbitrating ${stage} conflict`,
      detail: { conflictStage: stage, provider: solomonProvider, executorType: "agent" }
    })
  );

  // Collect pending suggestions from the session for Solomon's context
  const pendingSuggestions = Array.isArray(session.suggestions) && session.suggestions.length > 0
    ? session.suggestions.slice()
    : null;

  const solomon = new SolomonRole({ config, logger, emitter });
  await solomon.init({ task: conflict.task, iteration });
  let ruling;
  try {
    // Inject Solomon's own history so it doesn't repeat failed strategies
    const solomonHistory = extractSolomonHistory(session);
    const enrichedConflict = {
      ...conflict,
      ...(pendingSuggestions && { hostSuggestions: pendingSuggestions }),
      ...(solomonHistory.length > 0 && { previousSolomonRulings: solomonHistory })
    };
    ruling = await solomon.run({ conflict: enrichedConflict });
  } catch (err) {
    logger.warn(`Solomon threw: ${err.message}`);
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: `Solomon error: ${err.message}` }
    });
  }

  // Clear processed suggestions from session
  if (pendingSuggestions) {
    setSuggestions(session, []);
    try { await saveSession(session); } catch { /* best-effort */ }
  }

  const solomonError = ruling.result?.error;
  if (!ruling.ok && solomonError) {
    logger.warn(`Solomon execution failed: ${solomonError}`);
  }

  emitProgress(
    emitter,
    makeEvent("solomon:end", { ...eventBase, stage: "solomon" }, {
      message: ruling.ok
        ? `Solomon ruling: ${ruling.result?.ruling || "unknown"}`
        : `Solomon failed: ${(solomonError || ruling.summary || "unknown error").slice(0, 200)}`,
      detail: { ...ruling.result, provider: solomonProvider, executorType: "agent" }
    })
  );

  await addCheckpoint(session, {
    stage: "solomon",
    iteration,
    conflictStage: conflict?.stage || stage,
    ruling: ruling.result?.ruling,
    alternativeAgent: ruling.result?.alternativeAgent || null,
    waitUntil: ruling.result?.waitUntil || null,
    conditions: ruling.result?.conditions || [],
    escalate: ruling.result?.escalate,
    error: solomonError ? solomonError.slice(0, 500) : undefined,
    subtask: ruling.result?.subtask?.title || null
  });

  // Record the ruling for the session journal (decisions.md). Lazy-import so
  // this module stays free of journal-specific deps for callers that don't
  // need them.
  try {
    const { recordSolomonRuling } = await import("../session/journal/decisions-writer.js");
    recordSolomonRuling(session, {
      stage: conflict?.stage || stage,
      trigger: conflict?.reason || conflict?.summary || "solomon invoked",
      conflict: {
        task: conflict?.task,
        reason: conflict?.reason,
        summary: conflict?.summary,
        iterationCount: conflict?.iterationCount,
      },
      ruling: ruling.result?.ruling || (ruling.ok ? "continue" : "escalate_human"),
      reasoning: ruling.result?.reasoning || ruling.summary || "",
      conditions: ruling.result?.conditions || [],
      alternativeAgent: ruling.result?.alternativeAgent || null,
    });
  } catch { /* best-effort, don't break the pipeline on a journal hiccup */ }

  if (!ruling.ok) {
    const reason = ruling.result?.escalate_reason || solomonError || ruling.summary;
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: reason }
    });
  }

  const r = ruling.result?.ruling;
  if (r === "approve") {
    return { action: "approve", conditions: [], ruling };
  }
  if (r === "approve_with_conditions") {
    return {
      action: "continue",
      conditions: ruling.result?.conditions || [],
      extraIterations: ruling.result?.extraIterations || null,
      alternativeAgent: ruling.result?.alternativeAgent || null,
      waitUntil: ruling.result?.waitUntil || null,
      ruling
    };
  }

  if (r === "escalate_human") {
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: ruling.result?.escalate_reason || "Solomon escalated to human" }
    });
  }

  if (r === "create_subtask") {
    return { action: "subtask", subtask: ruling.result?.subtask, ruling };
  }

  return { action: "continue", conditions: [], ruling };
}

export function parseEscalationAnswer(answer) {
  if (!answer) return null;
  const trimmed = answer.trim().toLowerCase();
  // Option 1: Accept coder's work as-is
  if (trimmed === "1" || trimmed === "accept" || trimmed === "yes" || trimmed === "sí" || trimmed === "si") {
    return { action: "continue", humanGuidance: "Accept coder's work as-is" };
  }
  // Option 2: Retry with reviewer's feedback
  if (trimmed === "2" || trimmed === "retry") {
    return { action: "continue", humanGuidance: "Retry with reviewer feedback" };
  }
  // Option 3: Stop the session
  if (trimmed === "3" || trimmed.startsWith("stop") || trimmed.startsWith("pause")) {
    return { action: "stop" };
  }
  // Free-text: treat as human guidance (backward compat)
  return { action: "continue", humanGuidance: answer.trim() };
}

export async function escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration }) {
  const question = formatEscalationMessage({ ...conflict, stage }, session);

  if (askQuestion) {
    const answer = await askQuestion(question, { iteration, stage });
    const parsed = parseEscalationAnswer(answer);
    if (parsed && parsed.action === "continue") {
      return { action: "continue", humanGuidance: parsed.humanGuidance };
    }
    if (parsed && parsed.action === "stop") {
      // Fall through to pause session
    } else if (answer) {
      return { action: "continue", humanGuidance: answer };
    }
  }

  await pauseSession(session, {
    question,
    context: { iteration, stage, conflict }
  });
  emitProgress(
    emitter,
    makeEvent("question", { ...eventBase, stage }, {
      status: "paused",
      message: question,
      detail: { question, sessionId: session.id }
    })
  );

  return { action: "pause", question };
}
