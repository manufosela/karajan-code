// kj sentinel host trace (KJC-TSK-1434, ADR 0048), managed by `kj harden`.
// The hooks that already run on every tool call note the host agent at work in
// its lane, so kj stage can show it: a start (then a beat at most once a
// minute) with the kind of tool, each subagent it opens and closes, and its end
// when the turn stops. Names only: never a tool's input. Never blocks, never throws.
// Copied byte for byte into .karajan/harness.
import process from "node:process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BEAT_MS = 60 * 1000;
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const AGENT = "claude"; // the Sentinel's hooks are Claude Code's (sentinel-hooks.js)

/** The kind of tool, as the stage tells it: an MCP tool by its server and tool. */
const kindOf = (tool) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(String(tool));
  return (mcp ? mcp[1] + " " + mcp[2] : String(tool)).slice(0, 60);
};

/**
 * The trace lines a hook adds and the beats after it. `beats` is {sessionId:
 * last start ms}; `phase` is "pre" (before a tool), "post" (after it) or "stop".
 */
export function hostTrace(beats, call, phase, now) {
  const sid = String(call?.session_id ?? "default");
  const next = { ...beats };
  const lines = [];
  if (phase === "stop") {
    if (sid in next) lines.push({ agent: AGENT, role: "host", phase: "end", id: sid });
    delete next[sid];
    return { lines, beats: next };
  }
  const tool = call?.tool_name;
  if (phase === "pre" && (!(sid in next) || now - next[sid] >= BEAT_MS)) {
    lines.push({ agent: AGENT, role: "host", phase: "start", id: sid, tool: kindOf(tool) });
    next[sid] = now;
  }
  if (SUBAGENT_TOOLS.has(tool)) {
    const kind = String(call?.tool_input?.subagent_type || "general-purpose").slice(0, 40);
    lines.push({ agent: AGENT, role: "subagent", phase: phase === "pre" ? "start" : "end", id: String(call?.tool_use_id ?? sid), kind });
  }
  return { lines, beats: next };
}

/** Writes what `hostTrace` says into the lane at `root`; any failure is swallowed. */
export function traceHost(root, call, phase, now = Date.now()) {
  // The user's switch for the whole Sentinel: off, the guards note nothing either.
  if (process.env.KJ_SENTINEL_OFF === "1") return;
  try {
    const dir = join(root, ".karajan", "harness");
    const beatsFile = join(dir, "host-beats.json");
    let beats = {};
    try { beats = JSON.parse(readFileSync(beatsFile, "utf8")); } catch { /* first call of the lane */ }
    const { lines, beats: after } = hostTrace(beats, call, phase, now);
    if (!lines.length) return;
    // KJC-BUG-0527: the activity trace goes to .karajan/traces; the beats stay in harness (Sentinel state).
    const traces = join(root, ".karajan", "traces");
    mkdirSync(dir, { recursive: true });
    mkdirSync(traces, { recursive: true });
    const at = new Date(now).toISOString();
    appendFileSync(join(traces, "agent-activity.jsonl"), lines.map((l) => JSON.stringify({ at, ...l }) + "\n").join(""));
    writeFileSync(beatsFile, JSON.stringify(after));
  } catch { /* the trace is for the stage: it never stops a tool call */ }
}
