/**
 * ADR 0051 (#3763, HU-3773): a command the project pinned with `kj hooks set` wins over the
 * Makefile target and over the command detected for the stack. Stored in the project's
 * `.karajan/kj.config.yml` under `harden.commands.<step>`.
 */
import { loadProjectConfig } from "../config/loader.js";

export const HOOK_STEPS = ["lint", "format", "test"];
const MAX_COMMAND_LENGTH = 300;

/** The pinned commands, by step; only the known steps with a non-empty string count. */
export async function pinnedCommands(projectDir, load = loadProjectConfig) {
  const pinned = (await load(projectDir))?.harden?.commands ?? {};
  return Object.fromEntries(HOOK_STEPS.filter((s) => typeof pinned[s] === "string" && pinned[s] !== "").map((s) => [s, pinned[s]]));
}

/** Throws with the reason when the step or the command cannot be pinned. */
export function validatePin(step, command) {
  if (!HOOK_STEPS.includes(step)) throw new Error(`no hook step "${step}": ${HOOK_STEPS.join(", ")}`);
  if (typeof command !== "string" || command.trim() === "") throw new Error("the command is empty");
  if (/[\n\r\0]/.test(command)) throw new Error("the command has a newline or NUL");
  if (command.length > MAX_COMMAND_LENGTH) throw new Error(`the command is longer than ${MAX_COMMAND_LENGTH} characters`);
}
