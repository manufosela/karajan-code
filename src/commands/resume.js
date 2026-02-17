import { EventEmitter } from "node:events";
import { resumeFlow } from "../orchestrator.js";
import { createActivityLog } from "../activity-log.js";
import { printEvent } from "../utils/display.js";

export async function resumeCommand({ sessionId, answer, config, logger, flags }) {
  const jsonMode = flags?.json;

  const emitter = new EventEmitter();
  let activityLog = null;

  emitter.on("progress", (event) => {
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

  const result = await resumeFlow({
    sessionId,
    answer: answer || null,
    config,
    logger,
    flags: flags || {},
    emitter
  });

  if (jsonMode || !answer) {
    console.log(JSON.stringify(result, null, 2));
  }
}
