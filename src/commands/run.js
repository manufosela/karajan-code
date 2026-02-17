import { EventEmitter } from "node:events";
import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createActivityLog } from "../activity-log.js";
import { printHeader, printEvent } from "../utils/display.js";

export async function runCommandHandler({ task, config, logger, flags }) {
  await assertAgentsAvailable([config.coder, config.reviewer, config.reviewer_options?.fallback_reviewer]);

  const jsonMode = flags?.json;

  const emitter = new EventEmitter();
  let activityLog = null;

  emitter.on("progress", (event) => {
    // Initialize activity log once we have a sessionId
    if (!activityLog && event.sessionId) {
      activityLog = createActivityLog(event.sessionId);
      logger.onLog((entry) => activityLog.write(entry));
    }

    if (activityLog) {
      activityLog.writeEvent(event);
    }

    if (!jsonMode) {
      printEvent(event);
    }
  });

  if (!jsonMode) {
    printHeader({ task, config });
  }

  const result = await runFlow({ task, config, logger, flags, emitter });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  }
}
