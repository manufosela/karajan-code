import { EventEmitter } from "node:events";
import { resumeFlow } from "../orchestrator.js";
import { sweepOnResume } from "./steward.js";
import { createActivityLog } from "../activity-log.js";
import { printEvent } from "../utils/display/event-handlers.js";
import { withCliRunLog } from "../utils/cli-run-log.js";
import { registerRun, unregisterRun } from "../utils/run-registry.js";
import { createCliAskQuestion } from "../utils/cli-ask-question.js";

export async function resumeCommand({ sessionId, answer, config, logger, flags }) {
  const jsonMode = flags?.json;
  const quietMode = config.output?.quiet !== false;
  // STW-E (KJC-TSK-0793): resuming work is when someone is in front to review
  // the state — sweep if the report went stale; adoption stays explicit.
  await sweepOnResume({ config, logger });

  // Same wrapper as every other CLI command — without it `.kj/run.log`
  // is never opened during the resume and `kj-tail` stays silent
  // (every line of the resumed run goes only to the per-session
  // activity log + the local console). Also registers the run so the
  // HU Board shows it as live and can offer its Stop button.
  return withCliRunLog("resume", { projectDir: config?.projectDir, logger }, async ({ forwardProgress }) => {
    const runId = registerRun({
      pid: process.pid,
      planId: flags?.plan || null,
      huIds: null,
      projectDir: config?.projectDir || process.cwd(),
      source: "cli-resume",
    });
    const cleanupRegistry = () => { if (runId) unregisterRun(runId); };
    process.once("exit", cleanupRegistry);
    process.once("SIGTERM", () => { cleanupRegistry(); process.exit(143); });
    process.once("SIGINT", () => { cleanupRegistry(); process.exit(130); });

    const emitter = new EventEmitter();
    let activityLog = null;
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

    // KJC-BUG-0081 round 2 — propagate `flags` so the helper honours
    // `--yes` here too. Before this fix, `kj resume <id> --yes` in
    // non-TTY mode still routed every prompt to the HU Board bridge
    // and hung, exactly the bug the original PR #995 fixed for `kj run`.
    const askQuestion = createCliAskQuestion({ sessionId, flags });
    const result = await resumeFlow({
      sessionId,
      answer: answer || null,
      config,
      logger,
      flags: flags || {},
      emitter,
      askQuestion
    });

    if (jsonMode || !answer) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  });
}
