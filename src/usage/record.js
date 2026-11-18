// HU-4592 (ADR 0064): a local record of every agent call, one JSONL file per month
// under ~/.karajan/usage. It never holds prompts or code: only who ran what, for how long, at what cost.
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { accountFor } from "../accounts/store.js";
import { projectKey } from "../accounts/project-key.js";

const MONTH = /^\d{4}-\d{2}$/;

/** The month's file: <home>/usage/YYYY-MM.jsonl (UTC month). */
export function usageFile(month, { home = getKarajanHome() } = {}) {
  if (!MONTH.test(month)) throw new Error(`usage: "${month}" is not a YYYY-MM month`);
  return path.join(home, "usage", `${month}.jsonl`);
}

/** Appends one call to its month's file; appends are safe with several kj writing at once. */
export function appendUsage(entry, { home = getKarajanHome(), now = new Date() } = {}) {
  const ts = now.toISOString();
  const file = usageFile(ts.slice(0, 7), { home });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify({ ts, ...entry })}\n`, { mode: 0o600 });
}

/** The calls of one month, oldest first; [] when nothing was recorded that month. */
export function readUsage(month, { home = getKarajanHome() } = {}) {
  const file = usageFile(month, { home });
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`usage: ${path.basename(file)} line ${index + 1} is not JSON`, { cause: error });
    }
  });
}

const orNull = (value) => value ?? null;

function entryFor(agent, task, role, result, durationMs, home) {
  const project = projectKey(task.cwd);
  return {
    project,
    account: accountFor(agent.name, { home, projectKey: project }).id,
    provider: agent.name,
    role,
    model: orNull(result?.model),
    exitCode: orNull(result?.exitCode),
    durationMs,
    tokensIn: orNull(result?.tokens_in),
    tokensOut: orNull(result?.tokens_out),
    cachedTokens: orNull(result?.cached_tokens),
    costUsd: orNull(result?.cost_usd),
    rescue: false,
    linesAdded: null,
    linesRemoved: null,
  };
}

/** Wraps an agent's runTask and reviewTask so each call lands in the record. A failed write warns, never breaks the call. */
export function withUsageRecord(agent, { logger, home = getKarajanHome(), clock = Date.now } = {}) {
  for (const [method, defaultRole] of [["runTask", "coder"], ["reviewTask", "reviewer"]]) {
    const call = agent[method].bind(agent);
    agent[method] = async (task = {}) => {
      const started = clock();
      let result;
      try {
        result = await call(task);
        return result;
      } finally {
        try {
          appendUsage(entryFor(agent, task, task.role ?? defaultRole, result, clock() - started, home), { home });
        } catch (error) {
          logger?.warn?.(`usage: could not record the ${agent.name} call: ${error.message}`);
        }
      }
    };
  }
  return agent;
}
