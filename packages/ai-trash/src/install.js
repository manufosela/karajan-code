// Claude Code settings patcher (KJC-TSK-0390 commit 3). Idempotently
// adds a PreToolUse hook entry that pipes Bash commands through
// `kj-trash hook`. Preserves any unrelated keys and existing hooks so
// the user's other settings are untouched.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
// KJC-BUG-0095: the bare command fails SILENTLY when the bin drops off PATH
// (nvm switch, global reinstall) — the anti-delete net goes down without
// notice. The installed line fails CLOSED: a missing bin blocks the tool
// call (exit 2) naming the net and the remedy, never a quiet pass-through.
export const LEGACY_HOOK_COMMAND = "kj-trash hook";
export const HOOK_COMMAND =
  "if command -v kj-trash >/dev/null 2>&1; then exec kj-trash hook; fi; " +
  "echo 'kj-trash: bin not on PATH — the anti-delete net is DOWN. Fix: npm i -g karajan-code (or remove this hook from ~/.claude/settings.json).' >&2; exit 2";
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
  } else if (hasHookCommand(entry, LEGACY_HOOK_COMMAND) && command !== LEGACY_HOOK_COMMAND) {
    // KJC-BUG-0095 migration: upgrade the silent legacy line in place —
    // deduped (reviewer catch): an entry already carrying the new line
    // must end up with a single copy, not legacy-turned-duplicate.
    let seen = false;
    entry.hooks = entry.hooks
      .map((h) => (h.type === "command" && h.command === LEGACY_HOOK_COMMAND ? { ...h, command } : h))
      .filter((h) => {
        if (!(h.type === "command" && h.command === command)) return true;
        if (seen) return false;
        seen = true;
        return true;
      });
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
