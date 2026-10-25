// KJC-TSK-1206 (ADR 0030): puts a project back on the wiring kj harden wrote before
// the guards ran from the installed kj (node running the project's own copies).
// There the guard files are what runs, so they are what verify checks.
import fs from "node:fs";
import path from "node:path";
import { SENTINEL_WIRING } from "../../src/harden/sentinel-hooks.js";

export function wireLegacy(dir) {
  const hooks = {};
  for (const { event, matcher, script } of SENTINEL_WIRING) {
    const cmd = { type: "command", command: `node ${path.join(".karajan", "harness", script)}` };
    (hooks[event] ||= []).push(matcher === undefined ? { hooks: [cmd] } : { matcher, hooks: [cmd] });
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ hooks }));
}
