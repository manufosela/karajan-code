// KJC-TSK-1434 (ADR 0048): the host agent leaves a trace from the hooks it already
// runs, so kj stage shows it at work in its lane, and its subagents as they come and go.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BEAT_MS, hostTrace, traceHost } from "../../src/harden/sentinel/sentinel-activity.mjs";
import { GOVERNING_WIRING, SENTINEL_WIRING, installSentinelHooks, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";

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

describe("the stage's wiring", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "stage-wiring-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("kj harden installs it, but a project wired before it is not taken for tampered", () => {
    installSentinelHooks({ projectDir: dir, logger: { info() {}, warn() {} } });
    const settings = join(dir, ".claude", "settings.local.json");
    const cfg = JSON.parse(readFileSync(settings, "utf8"));
    expect(cfg.hooks.PostToolUse.map((e) => e.matcher)).toContain("Agent|Task");
    cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter((e) => e.matcher !== "Agent|Task");
    writeFileSync(settings, JSON.stringify(cfg));
    expect(verifySentinelScripts({ projectDir: dir })).toMatchObject({ ok: true });
    expect(GOVERNING_WIRING.some((e) => e.matcher === "Agent|Task")).toBe(false);
    expect(SENTINEL_WIRING.some((e) => e.matcher === "Agent|Task")).toBe(true);
  });
});

describe("traceHost", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "host-trace-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("appends the lines to the lane's agent-activity trace with their time, and remembers the beat", () => {
    traceHost(root, call("Bash"), "pre", Date.parse("2026-11-05T20:00:00Z"));
    traceHost(root, call("Read"), "pre", Date.parse("2026-11-05T20:00:10Z"));
    const rows = readFileSync(join(root, ".karajan", "traces", "agent-activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toEqual([{ at: "2026-11-05T20:00:00.000Z", agent: "claude", role: "host", phase: "start", id: "s1", tool: "Bash" }]);
    // KJC-BUG-0527: the trace is in traces; the beats (Sentinel state) stay in harness.
    expect(existsSync(join(root, ".karajan", "harness", "host-beats.json"))).toBe(true);
    expect(existsSync(join(root, ".karajan", "harness", "agent-activity.jsonl"))).toBe(false);
  });

  const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { stdio: "ignore" });
  const repoAt = (dir) => { git(dir, "init", "-q"); git(dir, "commit", "-q", "--allow-empty", "-m", "init"); };

  it("HU-3809: writes in the lane the call's cwd is in, not in the root the session started in", () => {
    repoAt(root);
    const lane = join(root, ".kj", "worktrees", "lane");
    git(root, "worktree", "add", "-q", "--detach", lane);
    mkdirSync(join(lane, "src"), { recursive: true });
    traceHost(root, call("Bash", { cwd: join(lane, "src") }), "pre", 0);
    expect(existsSync(join(lane, ".karajan", "traces", "agent-activity.jsonl"))).toBe(true);
    expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(false);
  });

  // HU-4110 (ADR 0034): a subagent's cwd stays in the main checkout; the lane is the path it touches.
  it.each([
    ["an Edit's file_path", (lane) => call("Edit", { cwd: root, tool_input: { file_path: join(lane, "src", "a.js") } })],
    ["a Bash git -C", (lane) => call("Bash", { cwd: root, tool_input: { command: "git -C " + lane + " status" } })],
    ["a Bash npm --prefix", (lane) => call("Bash", { cwd: root, tool_input: { command: "npm --prefix " + lane + " test" } })],
  ])("HU-4110: from the main checkout, %s inside a lane traces in that lane", (_what, make) => {
    repoAt(root);
    const lane = join(root, ".kj", "worktrees", "lane");
    git(root, "worktree", "add", "-q", "--detach", lane);
    traceHost(root, make(lane), "pre", 0);
    expect(existsSync(join(lane, ".karajan", "traces", "agent-activity.jsonl"))).toBe(true);
    expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(false);
  });

  it("HU-3809: a cwd in another repository keeps the trace in the root", () => {
    repoAt(root);
    const other = mkdtempSync(join(tmpdir(), "kj-other-repo-"));
    try {
      repoAt(other);
      traceHost(root, call("Bash", { cwd: other }), "pre", 0);
      expect(existsSync(join(other, ".karajan"))).toBe(false);
      expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(true);
    } finally { rmSync(other, { recursive: true, force: true }); }
  });

  it("HU-3809: falls back to the root when the cwd is missing or not in a git work tree", () => {
    traceHost(root, call("Bash", { cwd: join(root, "nowhere") }), "pre", 0);
    expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(true);
  });

  it("notes nothing while the user has the Sentinel off", () => {
    process.env.KJ_SENTINEL_OFF = "1";
    try { traceHost(root, call("Agent"), "post", 0); } finally { delete process.env.KJ_SENTINEL_OFF; }
    expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(false);
  });

  // KJC-BUG-0589 (the maintainer, 2026-11-14): agents piled up behind the bench. The coder kj
  // launches is a Claude session too, whose hooks noted it as a second host beside it.
  it("notes nothing for a session kj launched, which kj traces in its own role", () => {
    process.env.KJ_POLICY_ROLE = "coder";
    try {
      traceHost(root, call("Edit"), "pre", 0);
      traceHost(root, call("Agent"), "pre", 1);
      traceHost(root, call("Edit"), "stop", 2);
    } finally { delete process.env.KJ_POLICY_ROLE; }
    expect(existsSync(join(root, ".karajan", "traces", "agent-activity.jsonl"))).toBe(false);
  });

  it("never throws: a trace it cannot write is not a reason to stop a tool call", () => {
    expect(() => traceHost(join(root, "missing\0dir"), call("Bash"), "pre", 0)).not.toThrow();
  });
});
