#!/usr/bin/env node
// kj tool gate (KJC-TSK-0710) — managed by `kj harden`. Exit 2 blocks the
// tool call (stderr explains why); anything unexpected fails OPEN (exit 0)
// so a gate bug never bricks the session.
import console from "node:console";
import process from "node:process";
import { existsSync } from "node:fs";
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    if (tool === "Write" && input.file_path && existsSync(input.file_path)) {
      console.error("kj tool gate: Write over an EXISTING file destroys unseen changes — use Edit for targeted changes.");
      process.exit(2);
    }
  } catch { /* fail open */ }
  process.exit(0);
});
