// KJC-TSK-1429 (format decided by the maintainer on 2026-11-05): an agent kj
// launches leaves one line when it starts and one when it ends, in
// .karajan/traces/agent-activity.jsonl (KJC-BUG-0527: the sandbox leaves traces writable), so kj stage knows who works now.
// Never the prompt nor the output. Only where the caller names the project:
// without one there is nothing to trace, and tests leave no activity behind.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { takeLoaded } from "../skills/loaded.js";

export const ACTIVITY_FILE = ".karajan/traces/agent-activity.jsonl";

function note(projectDir, record, logger) {
  try {
    mkdirSync(join(projectDir, ".karajan", "traces"), { recursive: true });
    appendFileSync(join(projectDir, ACTIVITY_FILE), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
  } catch (err) {
    // The trace is for the stage only: losing it must never stop the agent's work.
    logger?.warn?.(`agent activity not traced in ${projectDir}: ${err.message}`);
  }
}

/** KJC-TSK-1536: the model and effort the role is launched with, as far as its config sets them. */
const launchedWith = (config, role) => {
  const { model, effort } = config?.roles?.[role] ?? {};
  return { ...(typeof model === "string" && model ? { model } : {}), ...(typeof effort === "string" && effort ? { effort } : {}) };
};

/** An agent whose runTask and reviewTask note their start and their end; the original is not changed. */
export function traceActivity(agent, { name, role, projectDir, logger, config }) {
  if (!projectDir) return agent;
  const traced = (method) => async (task) => {
    // KJC-TSK-1428: the atril skills loaded for this role ride on the start line.
    const skills = takeLoaded(projectDir, role);
    note(projectDir, { agent: name, role, phase: "start", ...(skills.length ? { skills } : {}), ...launchedWith(config, role) }, logger);
    try {
      const result = await method(task);
      note(projectDir, { agent: name, role, phase: "end", outcome: "ok" }, logger);
      return result;
    } catch (err) {
      note(projectDir, { agent: name, role, phase: "end", outcome: "failed" }, logger);
      throw err;
    }
  };
  // A wrapper over the agent, which stays untouched: everything else reads through to it.
  const wrapper = Object.create(agent);
  for (const method of ["runTask", "reviewTask"]) {
    if (typeof agent[method] === "function") wrapper[method] = traced(agent[method].bind(agent));
  }
  return wrapper;
}
