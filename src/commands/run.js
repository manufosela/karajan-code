import { EventEmitter } from "node:events";
import readline from "node:readline";
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

function createCliAskQuestion(opts = {}) {
  const { sessionId = null } = opts;
  return async (question, context) => {
    // Two paths:
    //   - Interactive TTY: prompt via readline (the developer's terminal).
    //   - No TTY (board's \u25b6 Run plan with stdio=ignore, CI, etc.): publish
    //     the prompt through the file-based bridge so the HU Board can
    //     surface it as a modal. The runner blocks on the bridge until
    //     the user answers (or times out / kills the run). Pre-v2.7.5
    //     this path just bailed; now the question actually gets answered.
    const stdinReadable = process.stdin && process.stdin.readable !== false;
    const isInteractive = Boolean(process.stdin?.isTTY) && stdinReadable;
    if (!isInteractive) {
      const { askThroughBoard } = await import("../utils/board-prompt-bridge.js");
      console.log(`\n\u2753 ${question}`);
      if (context?.detail) {
        console.log(`   Context: ${JSON.stringify(context.detail, null, 2)}`);
      }
      console.log(
        "\n[non-interactive] Routing the prompt to the HU Board.\n"
        + "  Open http://localhost:4000 \u2014 a modal will appear asking for your answer.\n"
        + "  This process is now waiting; closing the board does NOT cancel the run."
      );
      try {
        return await askThroughBoard({ sessionId, question, context });
      } catch (err) {
        console.log(`\n[prompt-bridge] ${err.message} \u2014 stopping the session.`);
        return null;
      }
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      console.log(`\n\u2753 ${question}`);
      if (context?.detail) {
        console.log(`   Context: ${JSON.stringify(context.detail, null, 2)}`);
      }
      rl.question("\n> Your response (or 'stop' to exit): ", (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === "stop") {
          resolve(null);
        } else {
          resolve(answer.trim());
        }
      });
    });
  };
}

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

    const askQuestion = createCliAskQuestion();

    // Spec-reviewer pre-pipeline audit (KJC-PCS-0048). Runs BEFORE
    // anything else — surfaces ambiguity / missing scope / missing AC
    // and lets the user bail out cheap, before any tokens burn.
    // Bypass with --skip-spec-review. Static import — the role runs
    // on every kj invocation (modulo bypass), no lazy-load benefit.
    const reviewResult = await runSpecReview({ spec: task, config, logger, askQuestion, flags });
    if (!reviewResult.proceed) {
      logger.info("Aborted by user after spec review.");
      cleanupRegistry();
      return { ok: false, aborted: true, reason: "spec-review-cancelled" };
    }

    let result;
    try {
      result = await runFlow({ task: task, config, logger, flags, emitter, askQuestion, pgTaskId: pgCardId || null, pgProject: pgProject || null });
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
