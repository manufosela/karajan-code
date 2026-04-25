import { EventEmitter } from "node:events";
import readline from "node:readline";
import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createActivityLog } from "../activity-log.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { printHeader } from "../utils/display/header.js";
import { printEvent } from "../utils/display/event-handlers.js";
import { resolveRole } from "../config.js";
import { parseCardId } from "../planning-game/adapter.js";

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
    const result = await runFlow({ task: task, config, logger, flags, emitter, askQuestion, pgTaskId: pgCardId || null, pgProject: pgProject || null });

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    }
    return { ok: !result?.paused && result?.approved !== false };
  });
}
