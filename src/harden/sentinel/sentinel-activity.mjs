// kj sentinel host trace (KJC-TSK-1434, ADR 0048), managed by `kj harden`.
// The hooks that already run on every tool call note the host agent at work in
// its lane, so kj stage can show it: a start (then a beat at most once a
// minute) with the kind of tool, each subagent it opens and closes, and its end
// when the turn stops. Names only: never a tool's input. Never blocks, never throws.
// Copied byte for byte into .karajan/harness.
import process from "node:process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

// [top-level, common git dir] of the work tree at `dir`.
const gitWhere = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");

// HU-4110 (ADR 0034 item 1): a Bash call's target dir, `git -C <dir>` or `--prefix <dir>`.
const BASH_TARGET = /(?:^|[\s;&|(])(?:git\s+-C|--prefix)(?:\s+|=)([^\s;&|()'"]+)/;
/** The path a call touches: an edit's file, a Bash git -C / --prefix target, else its cwd. */
const placeOf = (call) => {
  const input = call?.tool_input ?? {};
  const cwd = typeof call?.cwd === "string" && isAbsolute(call.cwd) ? call.cwd : null;
  const bash = call?.tool_name === "Bash" ? BASH_TARGET.exec(String(input.command ?? ""))?.[1] : null;
  const path = input.file_path || input.notebook_path || bash;
  if (typeof path !== "string") return cwd;
  if (isAbsolute(path)) return path;
  return cwd ? resolve(cwd, path) : null;
};
/** The deepest existing directory at or above `p` (a file not written yet resolves to its folder). */
const dirOf = (p) => {
  let d = p;
  while (!(existsSync(d) && statSync(d).isDirectory()) && dirname(d) !== d) d = dirname(d);
  return d;
};

/**
 * HU-3809, HU-4110: the lane of the path the call touches (see placeOf), when it is a work tree
 * of the same repository as `root`; otherwise `root`. Another repository never receives this trace.
 */
export function laneOf(root, call) {
  const place = placeOf(call);
  if (!place) return root;
  try {
    const [top, common] = gitWhere(dirOf(place));
    return top && common === gitWhere(root)[1] ? top : root;
  } catch { return root; } // not in a git work tree: the root's trace
}

/** Writes what `hostTrace` says into the lane the call works in (else `rootDir`); any failure is swallowed. */
export function traceHost(rootDir, call, phase, now = Date.now()) {
  // The user's switch for the whole Sentinel: off, the guards note nothing either.
  if (process.env.KJ_SENTINEL_OFF === "1") return;
  // KJC-BUG-0589: a session kj launched (its role in KJ_POLICY_ROLE, claude-agent.js) is not the
  // host: kj already traces it in that role, and noting it here drew a second host beside it.
  if (process.env.KJ_POLICY_ROLE) return;
  const root = laneOf(rootDir, call);
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
