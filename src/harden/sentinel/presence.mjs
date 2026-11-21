#!/usr/bin/env node
// kj sentinel presence beat (HU-4745, ADR 0048), managed by `kj harden`.
// A session that starts or gets a prompt is open; one that ends is closed. kj stage
// reads it to show the sessions waiting for the user, not only the ones at work.
// Stage wiring: governs nothing, writes nothing to stdout, never fails (exit 0).
// Copied byte for byte into .karajan/harness.
import process from "node:process";
import { ROOT } from "./sentinel-lib.mjs";
import { traceHost } from "./sentinel-activity.mjs";

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { hook_event_name: event, session_id: sid = "default", cwd = null } = JSON.parse(raw || "{}");
    traceHost(ROOT, { session_id: sid, cwd }, event === "SessionEnd" ? "close" : "open");
  } catch { /* the presence is for the stage: it never stops a session */ }
  process.exit(0);
});
