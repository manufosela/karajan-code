/**
 * After a plugin wrote or removed hooks / MCP entries in `.rulesync/` (ADR 0041): run `rulesync generate` when the
 * project opted in (`rulesync.generate: true`), else say the command. It reuses `generate` (the one runner `atril sync`
 * uses); nothing here runs for a plugin that left `.rulesync/` alone.
 */
import { readConfig } from "./config.js";
import { generate } from "./generate.js";
import { defaultRun, runRulesync } from "./rulesync-cli.js";

/**
 * Called BEFORE any change: with the option on and rulesync absent, a removal would leave `.rulesync/` ahead of the agents' files.
 * @throws when `rulesync.generate` is true and rulesync does not answer
 */
export function requireRulesync(opts = {}, run = defaultRun) {
  if (readConfig(opts).rulesync.generate !== true) return;
  try { runRulesync(["--version"], { projectDir: opts.projectDir ?? process.cwd() }, run); } catch (err) {
    throw new Error("rulesync.generate is true but rulesync is not installed; nothing was changed: install rulesync, or set rulesync.generate to false", { cause: err });
  }
}

/**
 * @param {boolean} wrote whether the plugin wrote or removed entries in `.rulesync/`
 * @returns {string | undefined} the line for the user; undefined when the plugin touched nothing
 * @throws when generate fails (the entries stay written in `.rulesync/`)
 */
export function generateAfter(wrote, opts = {}, run = defaultRun) {
  if (!wrote) return undefined;
  return generate(opts, run)
    ? "rulesync generate: done"
    : "run `rulesync generate --targets '*' --features '*'` to reach your agents, or declare rulesync.generate: true in atril.json";
}
