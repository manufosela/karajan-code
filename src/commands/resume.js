import { EventEmitter } from "node:events";
import readline from "node:readline";
import { resumeFlow } from "../orchestrator.js";
import { createActivityLog } from "../activity-log.js";
import { printEvent } from "../utils/display/event-handlers.js";

function createCliAskQuestion() {
  return async (question, context) => {
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

export async function resumeCommand({ sessionId, answer, config, logger, flags }) {
  const jsonMode = flags?.json;
  const quietMode = config.output?.quiet !== false;

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
      printEvent(event, { quiet: quietMode });
    }
  });

  const askQuestion = createCliAskQuestion();
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
}
