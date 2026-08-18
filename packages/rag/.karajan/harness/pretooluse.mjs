#!/usr/bin/env node
// kj tool gate (KJC-TSK-0710) — managed by `kj harden`. Exit 2 blocks the
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
      const writes = /open\s*\([^)]*["'][wa]["']|>\s*\S+\.json\b/.test(cmd);
      if (/json\.dumps?\s*\(/.test(cmd) && writes) {
        console.error("kj tool gate: reserializing a whole JSON file makes the diff unreviewable — make targeted edits instead (KJ_ALLOW_REWRITE=1 to override consciously).");
        process.exit(2);
      }
    }
  } catch { /* fail open */ }
  process.exit(0);
});
