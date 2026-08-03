/**
 * harness-hooks — the TOOL gate (KJC-TSK-0710, from proposal KJC-PRP-0013).
 * Field case 2026-08-02: text rules were not enough — the environment must
 * impose them AT TOOL TIME. `kj harden` writes a PreToolUse script and wires
 * it into the project's `.claude/settings.json` (merged, never clobbered):
 * Write over an existing file blocks ("use Edit", KJ_ALLOW_WRITE=1 escapes);
 * Bash that reserializes whole JSON files blocks (KJ_ALLOW_REWRITE=1).
 * Claude-only v1 — the abstraction arrives with the second host that
 * supports tool hooks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_BODY = `#!/usr/bin/env node
// kj tool gate (KJC-TSK-0710) — managed by \`kj harden\`. Exit 2 blocks the
// tool call (stderr explains why); anything unexpected fails OPEN (exit 0)
// so a gate bug never bricks the session.
import { existsSync } from "node:fs";
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    if (tool === "Write" && process.env.KJ_ALLOW_WRITE !== "1") {
      if (input.file_path && existsSync(input.file_path)) {
        console.error("kj tool gate: Write over an EXISTING file destroys unseen changes — use Edit for targeted changes (KJ_ALLOW_WRITE=1 to override consciously).");
        process.exit(2);
      }
    }
    if (tool === "Bash" && process.env.KJ_ALLOW_REWRITE !== "1") {
      const cmd = String(input.command || "");
      const writes = /open\\s*\\([^)]*["'][wa]["']|>\\s*\\S+\\.json\\b/.test(cmd);
      if (/json\\.dumps?\\s*\\(/.test(cmd) && writes) {
        console.error("kj tool gate: reserializing a whole JSON file makes the diff unreviewable — make targeted edits instead (KJ_ALLOW_REWRITE=1 to override consciously).");
        process.exit(2);
      }
    }
  } catch { /* fail open */ }
  process.exit(0);
});
`;

/** Write a managed hook script under .karajan/harness/ and return its path. */
export function writeHarnessScript(projectDir, name, body) {
  const dir = join(projectDir, ".karajan", "harness");
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, name);
  writeFileSync(abs, body, { mode: 0o755 });
  return abs;
}

/**
 * Merge hook entries into .claude/settings.json. Preserve, never clobber:
 * invalid JSON or a hook event with an unexpected (non-array) shape is the
 * user's business — the file is left alone and the caller wires manually.
 * entries: [{ event, matcher?, script }] where script is a .karajan/harness
 * basename; an entry is present when that script already appears under the
 * same event (and matcher, when given).
 */
export function mergeClaudeHooks({ projectDir, logger = console, entries }) {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      logger.warn?.(`kj harden: ${settingsPath} is not valid JSON — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  settings.hooks = settings.hooks || {};
  for (const { event } of entries) {
    if (event in settings.hooks && !Array.isArray(settings.hooks[event])) {
      logger.warn?.(`kj harden: ${settingsPath} has a non-array hooks.${event} — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  for (const { event, matcher, script } of entries) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const present = list.some(
      (e) => JSON.stringify(e).includes(script) && (matcher === undefined || e?.matcher === matcher),
    );
    if (!present) {
      const cmd = { type: "command", command: `node ${join(".karajan", "harness", script)}` };
      list.push(matcher === undefined ? { hooks: [cmd] } : { matcher, hooks: [cmd] });
    }
    settings.hooks[event] = list;
  }
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { wired: true };
}

/** Write the script and merge the PreToolUse entries into .claude/settings.json. */
export function installHarnessHooks({ projectDir = process.cwd(), logger = console } = {}) {
  const scriptAbs = writeHarnessScript(projectDir, "pretooluse.mjs", SCRIPT_BODY);
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [
      { event: "PreToolUse", matcher: "Write", script: "pretooluse.mjs" },
      { event: "PreToolUse", matcher: "Bash", script: "pretooluse.mjs" },
    ],
  });
  return { script: scriptAbs, wired };
}
