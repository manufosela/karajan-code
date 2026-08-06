/**
 * Generic Karajan-CLI launcher used by the board's "Commands" panel.
 * Wraps the same spawn-detached-with-log pattern that `runPlan`
 * already uses (see plan-mutations.js), but covers the broader set
 * of commands the user wants to trigger from the UI: plan,
 * architect, clean, etc.
 *
 * Security: the command name is matched against an explicit
 * whitelist. Free-form arg arrays are NOT allowed — each command
 * builds its argv from a typed schema. This keeps a curious browser
 * client from doing `node cli.js -e "rm -rf /"` via a crafted POST.
 *
 * Output: each command writes to `~/.karajan/hu-board-runs/
 * cmd-<commandId>.log`, which the existing `/api/plans/:planId/log`
 * endpoint can tail (we generalise it to take a log id, not just a
 * planId, in routes/api.js).
 */

import { mkdirSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Repo root → so we can spawn `node <repo>/src/cli.js …` regardless
// of whether `kj` is on $PATH for the board process.
const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));     // packages/hu-board/src
  return join(here, "..", "..", "..");                       // → repo root
})();
const KJ_CLI = join(REPO_ROOT, "src", "cli.js");

// Path now lives in db.js::getHuBoardRunsDir() — KJC-TSK-0421
// unification. The local helper is gone; callers import directly.
import { getHuBoardRunsDir } from "./db.js";

/**
 * Whitelist + argv builders. Each entry maps a logical command name
 * (`plan`, `architect`, `clean`) to a function that turns the
 * board-side input into a CLI argv. Adding a new command means: add
 * an entry here and an entry in the board UI's `COMMANDS` table.
 *
 * Why typed builders instead of a generic args array: the browser
 * client can't smuggle arbitrary flags. Anything that's not in the
 * whitelist is rejected with 400.
 *
 * Each builder returns `{ args, projectDir? }`. `projectDir` is the
 * cwd the spawn should use (defaults to the board's cwd).
 */
const COMMAND_BUILDERS = {
  plan: (input) => {
    const args = ["plan"];
    if (input.taskFile) args.push("--task-file", String(input.taskFile));
    if (input.context) args.push("--context", String(input.context));
    if (input.quick) args.push("--quick");
    if (input.noTestsSynth) args.push("--no-tests-synth");
    if (input.noPlanReview) args.push("--no-plan-review");
    // Positional task goes last when no --task-file was given.
    if (!input.taskFile && input.task) args.push(String(input.task));
    return { args, projectDir: input.projectDir };
  },
  architect: (input) => {
    const args = ["architect"];
    if (input.taskFile) args.push("--task-file", String(input.taskFile));
    if (input.context) args.push("--context", String(input.context));
    if (!input.taskFile && input.task) args.push(String(input.task));
    return { args, projectDir: input.projectDir };
  },
  clean: (input) => {
    const args = ["clean", "--yes"];      // never prompt; UI confirms ahead
    if (input.nuke) args.push("--nuke");
    if (input.dryRun) args.push("--dry-run");
    return { args };
  },
};

/**
 * Spawn the requested CLI command as a detached child. Returns
 * `{ ok, commandId, pid, logPath, argv }` so the caller can offer
 * the log to the user via the existing log viewer.
 *
 * Test seam: `KJ_RUN_SPAWN_MODE=echo` short-circuits the spawn so
 * vitest doesn't actually boot the orchestrator.
 *
 * @param {object} args
 * @param {string} args.command  - one of the COMMAND_BUILDERS keys
 * @param {object} [args.input]
 * @returns {{ ok: boolean, commandId?: string, pid?: number,
 *             logPath?: string, argv?: string[], error?: string }}
 */
export function runKjCommand({ command, input = {} } = {}) {
  const build = COMMAND_BUILDERS[command];
  if (!build) {
    return { ok: false, error: `Unsupported command: ${command}. Allowed: ${Object.keys(COMMAND_BUILDERS).join(", ")}` };
  }

  let built;
  try {
    built = build(input);
  } catch (err) {
    return { ok: false, error: `Bad input for "${command}": ${err.message}` };
  }

  const dir = getHuBoardRunsDir();
  mkdirSync(dir, { recursive: true });
  const commandId = `cmd-${command}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const logPath = join(dir, `${commandId}.log`);
  const argv = [KJ_CLI, ...built.args];

  if (process.env.KJ_RUN_SPAWN_MODE === "echo") {
    return { ok: true, commandId, pid: 0, logPath, argv: [process.execPath, ...argv] };
  }

  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn(process.execPath, argv, {
    cwd: built.projectDir || process.cwd(),
    detached: true,
    stdio: ["ignore", out, err],
    // KJ_INSIDE_BOARD: lets `kj clean --nuke` skip SIGTERMing the
    // board (it'd kill the page the user is looking at). Other
    // future "is this run hosted by the board" branches can read
    // the same flag.
    env: { ...process.env, CLAUDECODE: undefined, KJ_INSIDE_BOARD: "1" },
  });
  child.unref();
  return { ok: true, commandId, pid: child.pid ?? 0, logPath };
}

/** Test helper: list of command names exposed. */
export function listSupportedCommands() {
  return Object.keys(COMMAND_BUILDERS);
}
