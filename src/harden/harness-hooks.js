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

const SCRIPT_REL = join(".karajan", "harness", "pretooluse.mjs");

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

const hookEntry = (matcher) => ({ matcher, hooks: [{ type: "command", command: `node ${SCRIPT_REL}` }] });

/** Write the script and merge the PreToolUse entries into .claude/settings.json. */
export function installHarnessHooks({ projectDir = process.cwd(), logger = console } = {}) {
  const scriptAbs = join(projectDir, SCRIPT_REL);
  mkdirSync(join(projectDir, ".karajan", "harness"), { recursive: true });
  writeFileSync(scriptAbs, SCRIPT_BODY, { mode: 0o755 });

  const settingsPath = join(projectDir, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      logger.warn?.(`kj harden: ${settingsPath} is not valid JSON — leaving it untouched (tool gate script written, wire it manually)`);
      return { script: scriptAbs, wired: false };
    }
  }
  settings.hooks = settings.hooks || {};
  // Preserve, never clobber: an existing PreToolUse with an unexpected shape
  // is the user's business — leave the file alone (same as invalid JSON).
  if ("PreToolUse" in settings.hooks && !Array.isArray(settings.hooks.PreToolUse)) {
    logger.warn?.(`kj harden: ${settingsPath} has a non-array hooks.PreToolUse — leaving it untouched (tool gate script written, wire it manually)`);
    return { script: scriptAbs, wired: false };
  }
  const pre = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  for (const matcher of ["Write", "Bash"]) {
    const present = pre.some((e) => e?.matcher === matcher && JSON.stringify(e).includes("pretooluse.mjs"));
    if (!present) pre.push(hookEntry(matcher));
  }
  settings.hooks.PreToolUse = pre;
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { script: scriptAbs, wired: true };
}
