// KJC-TSK-1434 (ADR 0048): the host agent leaves a trace from the hooks it already
// runs, so kj stage shows it at work in its lane, and its subagents as they come and go.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BEAT_MS, hostTrace, traceHost } from "../../src/harden/sentinel/sentinel-activity.mjs";

const call = (tool, extra = {}) => ({ session_id: "s1", tool_name: tool, tool_use_id: "t1", ...extra });

describe("hostTrace", () => {
  it("starts the host on its first tool call, naming the kind of tool, then beats at most once a minute", () => {
    const first = hostTrace({}, call("Bash"), "pre", 1000);
    expect(first.lines).toEqual([{ agent: "claude", role: "host", phase: "start", id: "s1", tool: "Bash" }]);
    expect(hostTrace(first.beats, call("Edit"), "pre", 1000 + BEAT_MS - 1).lines).toEqual([]);
    expect(hostTrace(first.beats, call("Edit"), "pre", 1000 + BEAT_MS).lines).toEqual([{ agent: "claude", role: "host", phase: "start", id: "s1", tool: "Edit" }]);
  });

  it("names an MCP tool by its server and tool, never its input", () => {
    const { lines } = hostTrace({}, call("mcp__planning-game__update_card", { tool_input: { secret: "x" } }), "pre", 0);
    expect(lines[0].tool).toBe("planning-game update_card");
    expect(JSON.stringify(lines)).not.toContain("secret");
  });

  it("a subagent starts when the host opens it and ends when it comes back, by its own id and type", () => {
    const open = hostTrace({ s1: 0 }, call("Agent", { tool_use_id: "a7", tool_input: { subagent_type: "Explore", prompt: "p" } }), "pre", 10);
    expect(open.lines).toEqual([{ agent: "claude", role: "subagent", phase: "start", id: "a7", kind: "Explore" }]);
    const back = hostTrace(open.beats, call("Task", { tool_use_id: "a7" }), "post", 20);
    expect(back.lines).toEqual([{ agent: "claude", role: "subagent", phase: "end", id: "a7", kind: "general-purpose" }]);
  });

  it("the host ends when its turn stops, and only if it had started", () => {
    const { lines, beats } = hostTrace({ s1: 5 }, { session_id: "s1" }, "stop", 9);
    expect(lines).toEqual([{ agent: "claude", role: "host", phase: "end", id: "s1" }]);
    expect(beats).toEqual({});
    expect(hostTrace({}, { session_id: "s1" }, "stop", 9).lines).toEqual([]);
  });
});

describe("traceHost", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "host-trace-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("appends the lines to the lane's agent-activity trace with their time, and remembers the beat", () => {
    traceHost(root, call("Bash"), "pre", Date.parse("2026-11-05T20:00:00Z"));
    traceHost(root, call("Read"), "pre", Date.parse("2026-11-05T20:00:10Z"));
    const rows = readFileSync(join(root, ".karajan", "harness", "agent-activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toEqual([{ at: "2026-11-05T20:00:00.000Z", agent: "claude", role: "host", phase: "start", id: "s1", tool: "Bash" }]);
  });

  it("notes nothing while the user has the Sentinel off", () => {
    process.env.KJ_SENTINEL_OFF = "1";
    try { traceHost(root, call("Agent"), "post", 0); } finally { delete process.env.KJ_SENTINEL_OFF; }
    expect(existsSync(join(root, ".karajan", "harness", "agent-activity.jsonl"))).toBe(false);
  });

  it("never throws: a trace it cannot write is not a reason to stop a tool call", () => {
    expect(() => traceHost(join(root, "missing\0dir"), call("Bash"), "pre", 0)).not.toThrow();
  });
});
