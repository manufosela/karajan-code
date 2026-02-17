import fs from "node:fs/promises";
import path from "node:path";
import { getSessionRoot } from "./utils/paths.js";
import { ensureDir } from "./utils/fs.js";

export function createActivityLog(sessionId) {
  const logPath = path.join(getSessionRoot(), sessionId, "activity.log");
  let buffer = [];
  let flushing = false;

  function formatLine(entry) {
    const ts = entry.timestamp || new Date().toISOString();
    const lvl = (entry.level || "info").toUpperCase().padEnd(5);
    const ctx = entry.context
      ? Object.entries(entry.context)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      : "";
    const ctxStr = ctx ? ` ${ctx}` : "";
    return `${ts} [${lvl}]${ctxStr} ${entry.message || ""}`;
  }

  async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const lines = buffer.splice(0);
    try {
      await ensureDir(path.dirname(logPath));
      await fs.appendFile(logPath, lines.join("\n") + "\n", "utf8");
    } catch {
      // best-effort: I/O errors do not crash the flow
    }
    flushing = false;
    if (buffer.length > 0) flush();
  }

  return {
    write(logEntry) {
      buffer.push(formatLine(logEntry));
      flush();
    },
    writeEvent(progressEvent) {
      const entry = {
        timestamp: progressEvent.timestamp,
        level: progressEvent.status === "fail" ? "error" : "info",
        context: {
          iteration: progressEvent.iteration,
          stage: progressEvent.stage
        },
        message: progressEvent.message || progressEvent.type
      };
      this.write(entry);
    },
    get path() {
      return logPath;
    }
  };
}
