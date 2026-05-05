/**
 * PerfStage — webperf quality gate inside the iteration loop.
 *
 * KJC-TSK-0151. Wraps PerfRole and slots into the existing
 * runQualityGateStages flow alongside Sonar and Impeccable. Designed
 * to be the simplest possible quality gate:
 *
 *   - PASS verdict (cwv.pass === true) → return ok, iteration continues.
 *   - FAIL verdict → set reviewer feedback with the blocking metrics
 *     so the coder receives concrete guidance next iteration. Returns
 *     `continue` to retry the iteration loop. No repeat-detector +
 *     retry-limit machinery: rerunning Lighthouse on the same URL
 *     gives the same result unless the coder changes something, and
 *     the iteration limit (max_iterations) is the natural ceiling.
 *   - Scanner unavailable (lighthouse missing, URL unreachable, timeout)
 *     → log a warn and return ok-skipped. Best-effort, never blocks
 *     the pipeline by itself.
 *
 * The role surface (PerfRole) is responsible for persisting the result
 * to ~/.karajan/webperf/<slug>/last.json so subsequent `kj audit` runs
 * pick it up via the auto-discovery added in #602.
 */

import { PerfRole } from "../../roles/perf-role.js";
import { setReviewerFeedback } from "../../session/mutators.js";
import { saveSession } from "../../session/store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";

/**
 * Build the human-readable feedback line that goes back to the coder
 * on FAIL. Concrete enough that the LLM can act on it without re-reading
 * the whole report.
 */
function buildFeedback(roleResult) {
  const { result } = roleResult;
  const score = typeof result.performanceScore === "number" ? result.performanceScore : null;
  const blocking = (result.cwv?.blocking || []).map(b => `${b.metric.toUpperCase()}=${Math.round(b.value)} (poor>${b.threshold})`);
  const top = (result.issues || []).slice(0, 3).map(i => `${i.id}${i.savingsMs ? ` (~${Math.round(i.savingsMs)}ms)` : ""}`);

  const lines = [`Webperf gate FAILED${score !== null ? ` (score ${score}/100)` : ""}.`];
  if (blocking.length > 0) lines.push(`Blocking metrics: ${blocking.join(", ")}.`);
  if (top.length > 0) lines.push(`Top opportunities: ${top.join(", ")}.`);
  lines.push("Address the blocking metric(s) before the next iteration; rerunning without code changes will produce the same verdict.");
  return lines.join(" ");
}

/**
 * Run the perf gate against config.webperf.url.
 *
 * @returns {Promise<{action: "ok"|"continue", stageResult?: object, summary?: string}>}
 */
export async function runPerfStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, task: _task, brainCtx }) {
  if (!session) {
    throw new Error("runPerfStage: `session` is required.");
  }
  logger.setContext({ iteration, stage: "perf" });
  emitProgress(
    emitter,
    makeEvent("perf:start", { ...eventBase, stage: "perf" }, {
      message: "WebPerf gate scanning",
      detail: { url: config?.webperf?.url || null, preset: config?.webperf?.preset || "desktop" },
    })
  );

  const role = new PerfRole({ config, logger, emitter });
  const roleResult = await role.execute();

  // Track budget — the role doesn't spawn an LLM but it does consume wall
  // time; surface that in the budget summary alongside the agent calls.
  if (trackBudget) {
    try { trackBudget("perf", { tokens_in: 0, tokens_out: 0, cost_usd: 0 }); } catch { /* best-effort */ }
  }

  // Scanner unavailable → skip with warn. PerfRole returns ok=false for
  // both "verdict FAIL" and "scanner failed", so we differentiate on the
  // result.error field (set only by the second case).
  if (!roleResult.ok && roleResult.result?.error) {
    logger.warn(`Perf gate skipped: ${roleResult.result.error}`);
    emitProgress(emitter, makeEvent("perf:end", { ...eventBase, stage: "perf" }, {
      status: "warn",
      message: `Perf gate skipped — ${roleResult.result.error}`,
    }));
    return { action: "ok", stageResult: { skipped: true, reason: roleResult.result.error } };
  }

  // PASS verdict
  if (roleResult.ok === true) {
    emitProgress(emitter, makeEvent("perf:end", { ...eventBase, stage: "perf" }, {
      status: "ok",
      message: roleResult.summary,
    }));
    return {
      action: "ok",
      stageResult: {
        verdict: "PASS",
        url: roleResult.result?.url,
        performanceScore: roleResult.result?.performanceScore,
        cwv: roleResult.result?.cwv,
        savedPath: roleResult.result?.savedPath,
        summary: roleResult.summary,
      },
    };
  }

  // FAIL verdict → push concrete feedback to the coder for next iteration.
  const feedback = buildFeedback(roleResult);
  setReviewerFeedback(session, feedback);
  await saveSession(session);

  // Brain: when enabled, surface perf feedback on the queue too.
  if (brainCtx?.enabled) {
    try {
      const { processRoleOutput } = await import("../brain-coordinator.js");
      processRoleOutput(brainCtx, {
        roleName: "perf",
        output: { verdict: "fail", summary: feedback },
        iteration,
      });
    } catch (err) {
      logger.warn(`Perf gate: brain queue push failed (non-blocking): ${err.message}`);
    }
  }

  emitProgress(emitter, makeEvent("perf:end", { ...eventBase, stage: "perf" }, {
    status: "fail",
    message: roleResult.summary,
  }));

  return {
    action: "continue",
    stageResult: {
      verdict: "FAIL",
      url: roleResult.result?.url,
      performanceScore: roleResult.result?.performanceScore,
      cwv: roleResult.result?.cwv,
      issues: roleResult.result?.issues,
      summary: feedback,
    },
  };
}
