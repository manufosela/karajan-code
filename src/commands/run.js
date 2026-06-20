import { EventEmitter } from "node:events";
import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createActivityLog } from "../activity-log.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { registerRun, unregisterRun } from "../utils/run-registry.js";
import { printHeader } from "../utils/display/header.js";
import { printEvent } from "../utils/display/event-handlers.js";
import { printResumeHint } from "../utils/display/resume-hint.js";
import { resolveRole } from "../config.js";
import { parseCardId } from "../planning-game/adapter.js";
import { confirmCwd } from "../utils/cwd-confirm.js";
import { runSpecReview } from "../spec-review/run-spec-review.js";
import { maybeAutoUpdate } from "../rag/auto-update.js";

// Re-export the shared helper so existing imports (tests, MCP wrappers)
// keep working. KJC-BUG-0081 round 2 split the body into utils/ because
// resume.js also needs the same contract.
import { createCliAskQuestion } from "../utils/cli-ask-question.js";
import { buildDecider } from "../autonomy/decider.js";
import { createAutonomyAskQuestion } from "../autonomy/stage-ask.js";
export { createCliAskQuestion };

export async function runCommandHandler({ task, config, logger, flags }) {
  // PR-F (cwd confirmation): when launching from an interactive
  // terminal, surface the working directory so the user can abort if
  // they typed `kj run` from the wrong place. The user's words:
  // "todas las que lo lancé desde terminal te garantizo que estaba
  // en la carpeta del proyecto … aún así preguntar por si acaso".
  //
  // Skip the prompt when:
  //   - --yes / -y is set (CI / scripted runs),
  //   - --json mode is on (machine-readable output, no TTY assumed),
  //   - stdin is not a TTY (piped, board-spawned subprocess, MCP).
  const projectDir = config?.projectDir || process.cwd();
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY
    && !flags?.yes && !flags?.json;
  if (canPrompt) {
    const ok = await confirmCwd(projectDir);
    if (!ok) {
      console.log("Aborted by user.");
      return { ok: false, aborted: true };
    }
  }

  // KJC-TSK-0455 — Pre-run drift check. Default ON; opt out with
  // --no-rag-update (flag) or config.rag.autoUpdate.onRun=false. If the
  // local index is behind HEAD we re-embed the delta before the agents
  // start reading from the RAG store; on any failure we log and move on
  // so a broken vector store never blocks a run.
  await maybeAutoUpdate({ projectDir, config, logger, flags });

  // Best-effort session cleanup before starting
  try {
    const { cleanupExpiredSessions } = await import("../session-cleanup.js");
    await cleanupExpiredSessions({ logger });
  } catch { /* non-blocking */ }

  const requiredProviders = [
    resolveRole(config, "coder").provider
  ];
  if (config.pipeline?.reviewer?.enabled !== false) {
    requiredProviders.push(resolveRole(config, "reviewer").provider);
  }
  if (config.pipeline?.triage?.enabled) requiredProviders.push(resolveRole(config, "triage").provider);
  if (config.pipeline?.planner?.enabled) requiredProviders.push(resolveRole(config, "planner").provider);
  if (config.pipeline?.refactorer?.enabled) requiredProviders.push(resolveRole(config, "refactorer").provider);
  if (config.pipeline?.researcher?.enabled) requiredProviders.push(resolveRole(config, "researcher").provider);
  if (config.pipeline?.tester?.enabled) requiredProviders.push(resolveRole(config, "tester").provider);
  if (config.pipeline?.security?.enabled) requiredProviders.push(resolveRole(config, "security").provider);
  await assertAgentsAvailable(requiredProviders);

  // --- Planning Game: resolve card ID ---
  const pgCardId = flags?.pgTask || parseCardId(task);
  const pgProject = flags?.pgProject || config.planning_game?.project_id || null;

  const jsonMode = flags?.json;
  // Quiet mode is the default; --verbose disables it
  const quietMode = config.output?.quiet !== false;

  return withCliRunLog("run", { projectDir: config?.projectDir, logger }, async ({ runLog, forwardProgress }) => {
    runLog.logText(`[kj_run] task="${String(task).slice(0, 80)}..."`);

    // KJC-TSK-0396 extensión: registrar el PID + planId + huIds en
    // ~/.karajan/runs/<runId>.json para que el HU Board pueda mostrar
    // el botón ⏹ Stop incluso cuando el run se lanza desde terminal
    // externa (no solo desde el botón ▶ Run del board). Best-effort:
    // si la escritura falla, el run sigue su curso normal. Limpieza
    // garantizada en el finally del withCliRunLog vía registry.unregisterRun.
    const huIdsFromFlag = typeof flags?.hu === "string"
      ? flags.hu.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const runId = registerRun({
      pid: process.pid,
      planId: flags?.plan || null,
      huIds: huIdsFromFlag,
      projectDir: config?.projectDir || process.cwd(),
      source: "cli",
    });
    const cleanupRegistry = () => { if (runId) unregisterRun(runId); };
    // Cubrir todos los caminos de salida del proceso.
    process.once("exit", cleanupRegistry);
    process.once("SIGTERM", () => { cleanupRegistry(); process.exit(143); });
    process.once("SIGINT", () => { cleanupRegistry(); process.exit(130); });

    const emitter = new EventEmitter();
    let activityLog = null;

    // Mirror every progress event into .kj/run.log so kj-tail works identically
    // whether the command came from the MCP server or the CLI (KJC-TSK-0327 follow-up).
    forwardProgress(emitter);

    emitter.on("progress", (event) => {
      if (!activityLog && event.sessionId) {
        activityLog = createActivityLog(event.sessionId);
        logger.onLog((entry) => activityLog.write(entry));
      }

      if (activityLog) {
        activityLog.writeEvent(event);
      }

      if (!jsonMode) {
        printEvent(event, { quiet: quietMode });
      }
    });

    if (!jsonMode) {
      printHeader({ task: task, config });
    }

    const askQuestion = createCliAskQuestion({ flags });

    // Autonomy (KJC-PCS-0062): wire the level to a resolver. In autonomous mode
    // every gate is decided by the Arbiter instead of the human; interactive
    // keeps the human prompts. The decider is threaded into the gates below.
    const { autonomy, resolve: decide } = buildDecider({ config, flags, ask: askQuestion, logger });

    // Spec-reviewer pre-pipeline audit (KJC-PCS-0048). Runs BEFORE
    // anything else — surfaces ambiguity / missing scope / missing AC.
    // In autonomous mode the Arbiter decides (never aborts); interactive
    // lets the user bail. Bypass with --skip-spec-review.
    const reviewResult = await runSpecReview({ spec: task, config, logger, askQuestion, flags, resolve: decide, autonomy });
    if (!reviewResult.proceed) {
      logger.info("Aborted by user after spec review.");
      cleanupRegistry();
      return { ok: false, aborted: true, reason: "spec-review-cancelled" };
    }
    // If the user refined the spec via [r]efine, downstream runs the
    // REFINED text (not the original) so the pipeline acts on what the
    // user actually approved.
    const effectiveTask = reviewResult.refined && reviewResult.finalSpec ? reviewResult.finalSpec : task;

    // AUTO-E: in autonomous mode the stages never ask a human or block on the
    // board — they auto-continue with the least-bad choice. interactive/assisted
    // keep the human prompts.
    const stageAsk = createAutonomyAskQuestion({ baseAsk: askQuestion, autonomy, logger });

    let result;
    try {
      result = await runFlow({ task: effectiveTask, config, logger, flags, emitter, askQuestion: stageAsk, pgTaskId: pgCardId || null, pgProject: pgProject || null });
    } finally {
      // KJC-TSK-0396: limpia el registro pase lo que pase (éxito,
      // throw, o paused). Los handlers de SIGINT/SIGTERM/exit son
      // backstop para casos donde el throw no llega aquí (segfault,
      // kill -9, etc.).
      cleanupRegistry();
    }

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Last line printed: if the run stopped (hibernated / paused /
      // failed), tell the user the exact command to resume it.
      printResumeHint(result);
    }
    return { ok: !result?.paused && result?.approved !== false };
  });
}
