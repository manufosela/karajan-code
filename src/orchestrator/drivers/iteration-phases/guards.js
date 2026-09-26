/**
 * Iteration phase: deterministic output / perf guards on the diff.
 *
 * Extracted verbatim from `src/orchestrator/drivers/iteration-loop.js` in
 * the v2.7.x audit follow-up to keep the iteration-loop driver under the
 * 600-LOC ceiling. Behaviour is byte-for-byte identical to the inlined
 * version.
 *
 * Returns { action: "ok" | "return", result? }.
 *   - "ok"     → caller continues to the next phase.
 *   - "return" → caller returns `result` (output guard blocked on critical
 *                violations).
 */

import { emitProgress, makeEvent } from "../../../utils/events.js";
import { markSessionStatus, addCheckpoint } from "../../../session/store.js";
import { generateDiff, computeBaseRef } from "../../../review/diff-generator.js";
import { scanDiff } from "../../../guards/output-guard.js";
import { scanPerfDiff } from "../../../guards/perf-guard.js";

export async function runGuardStages({ config, logger, emitter, eventBase, session, iteration }) {
  const outputEnabled = config.guards?.output?.enabled !== false;
  const perfEnabled = config.guards?.perf?.enabled !== false;

  if (!outputEnabled && !perfEnabled) return { action: "ok" };

  // KJC-BUG-0214 (issue #1733): los guards juzgan LO QUE HA HECHO ESTE RUN, no
  // la rama entera. Con el merge-base contra la base, cualquier linea anadida
  // en cualquier momento de la rama contaba como recien escrita, y una
  // ejecucion se bloqueo por codigo preexistente que el coder no toco. La
  // sesion ya guarda HEAD al arrancar precisamente para esto.
  const baseBranch = config.base_branch || "main";
  const runStart = session?.head_at_start || session?.session_start_sha || null;
  let diff;
  try {
    const baseRef = runStart || await computeBaseRef({ baseBranch });
    if (!runStart) logger.warn("Guards: sin punto de arranque del run, se juzga la rama entera contra la base");
    diff = await generateDiff({ baseRef, projectDir: config?.projectDir || null });
  } catch {
    logger.warn("Guards: could not generate diff, skipping");
    return { action: "ok" };
  }

  if (!diff) return { action: "ok" };

  if (outputEnabled) {
    const outputResult = scanDiff(diff, config);
    if (outputResult.violations.length > 0) {
      const critical = outputResult.violations.filter(v => v.severity === "critical");
      const warnings = outputResult.violations.filter(v => v.severity === "warning");
      emitProgress(emitter, makeEvent("guard:output", { ...eventBase, stage: "guard" }, {
        message: `Output guard: ${critical.length} critical, ${warnings.length} warnings`,
        detail: { violations: outputResult.violations, executorType: "local" }
      }));
      logger.info(`Output guard: ${outputResult.violations.length} violation(s) found`);
      for (const v of outputResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-output", iteration, pass: outputResult.pass, violations: outputResult.violations.length });

      if (!outputResult.pass && config.guards.output.on_violation === "block") {
        await markSessionStatus(session, "failed");
        emitProgress(emitter, makeEvent("guard:blocked", { ...eventBase, stage: "guard" }, {
          message: "Output guard blocked: critical violations detected",
          detail: { violations: critical }
        }));
        return {
          action: "return",
          result: { approved: false, sessionId: session.id, reason: "guard_blocked", violations: critical }
        };
      }
    }
  }

  if (perfEnabled) {
    const perfResult = scanPerfDiff(diff, config);
    if (!perfResult.skipped && perfResult.violations.length > 0) {
      emitProgress(emitter, makeEvent("guard:perf", { ...eventBase, stage: "guard" }, {
        message: `Perf guard: ${perfResult.violations.length} issue(s)`,
        detail: { violations: perfResult.violations, executorType: "local" }
      }));
      logger.info(`Perf guard: ${perfResult.violations.length} issue(s) found`);
      for (const v of perfResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-perf", iteration, pass: perfResult.pass, violations: perfResult.violations.length });
    }
  }

  return { action: "ok" };
}
