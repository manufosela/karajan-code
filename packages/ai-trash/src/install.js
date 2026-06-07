// Claude Code settings patcher (KJC-TSK-0390 commit 3). Idempotently
// adds a PreToolUse hook entry that pipes Bash commands through
// `kj-trash hook`. Preserves any unrelated keys and existing hooks so
// the user's other settings are untouched.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
export const HOOK_COMMAND = "kj-trash hook";
const MATCHER = "Bash";

async function readSettings(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function hasHookCommand(matcherEntry, command) {
  return (matcherEntry.hooks ?? []).some((h) => h.type === "command" && h.command === command);
}

export function patchSettings(settings, command = HOOK_COMMAND, matcher = MATCHER) {
  const next = { ...settings };
  next.hooks = { ...(next.hooks ?? {}) };
  const preToolUse = Array.isArray(next.hooks.PreToolUse) ? next.hooks.PreToolUse.slice() : [];
  let entry = preToolUse.find((e) => e.matcher === matcher);
  let mutated = false;
  if (!entry) {
    entry = { matcher, hooks: [{ type: "command", command }] };
    preToolUse.push(entry);
    mutated = true;
  } else if (!hasHookCommand(entry, command)) {
    entry.hooks = [...(entry.hooks ?? []), { type: "command", command }];
    mutated = true;
  }
  next.hooks.PreToolUse = preToolUse;
  return { settings: next, mutated };
}

export async function installClaudeCodeHook({ path = DEFAULT_SETTINGS_PATH, command = HOOK_COMMAND } = {}) {
  const settings = await readSettings(path);
  const { settings: next, mutated } = patchSettings(settings, command);
  if (!mutated) return { path, mutated: false };
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8" });
  return { path, mutated: true };
}
