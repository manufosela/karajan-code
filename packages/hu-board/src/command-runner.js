/**
 * Generic Karajan-CLI launcher used by the board's "Commands" panel.
 * Spawns a whitelisted `kj` command detached, with its output in a
 * log the board can tail. Today the whitelist holds `clean`.
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

import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
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
 * (e.g. `clean`) to a function that turns the
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
// KJC-TSK-1323: `plan` (generate) and `architect` left with 5.0, which retired them;
// a request for either now gets the 400 of any command outside the whitelist.
const COMMAND_BUILDERS = {
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

  return spawnKj(command, built);
}

/** Spawn `kj <args>` detached, its output in a run log the board can tail. */
function spawnKj(command, built) {
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

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * KJC-TSK-1324: the ▶ of a card. `kj hu start <id> --code` checks the card, opens its lane
 * and has the panel coder write it there; review and commit stay with the person. Only a card
 * id and an absolute git checkout get through, never a free-form argument.
 */
export function startCardInLane({ id, projectDir } = {}) {
  if (!CARD_ID.test(String(id ?? ""))) return { ok: false, error: `not a card id: ${id}` };
  if (!isAbsolute(String(projectDir ?? "")) || !existsSync(join(projectDir, ".git"))) {
    return { ok: false, error: `not a git checkout: ${projectDir}` };
  }
  const lane = laneOfCard({ id, projectDir });
  if (lane) return { ok: false, lane, error: `${id} already has a lane: ${lane}` };
  return spawnKj("hu-start", { args: ["hu", "start", id, "--code"], projectDir });
}

/** The lane a card already has (kj names it <id>-<slug>), or null. */
export function laneOfCard({ id, projectDir }) {
  const lanes = join(projectDir, ".kj", "worktrees");
  const found = existsSync(lanes) ? readdirSync(lanes).find((name) => name.startsWith(`${id}-`)) : null;
  return found ? join(lanes, found) : null;
}

/** Test helper: list of command names exposed. */
export function listSupportedCommands() {
  return Object.keys(COMMAND_BUILDERS);
}
