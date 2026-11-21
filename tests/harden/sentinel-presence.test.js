// HU-4745 (KJC-TSK-1714): a presence beat, so kj stage also shows the host sessions that are
// open and waiting for the user, not only the ones at work.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEAT_MS, hostPid, hostTrace, traceHost } from "../../src/harden/sentinel/sentinel-activity.mjs";
import { GOVERNING_WIRING, SENTINEL_WIRING, installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { SENTINEL_GUARDS } from "../../src/harden/sentinel-guards.js";

const PRESENCE = fileURLToPath(new URL("../../src/harden/sentinel/presence.mjs", import.meta.url));
const open = (sid = "s1", host_pid = 4242) => ({ session_id: sid, host_pid });
const rowsOf = (root) => readFileSync(join(root, ".karajan", "traces", "agent-activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("hostTrace: presence", () => {
  it("a session opens with its host's pid, at most once a minute", () => {
    const first = hostTrace({}, open(), "open", 1000);
    expect(first.lines).toEqual([{ agent: "claude", role: "host", phase: "open", id: "s1", pid: 4242 }]);
    expect(hostTrace(first.beats, open(), "open", 1000 + BEAT_MS - 1).lines).toEqual([]);
    expect(hostTrace(first.beats, open(), "open", 1000 + BEAT_MS).lines).toHaveLength(1);
  });

  it("an open without a pid names none", () => {
    expect(hostTrace({}, { session_id: "s1" }, "open", 0).lines).toEqual([{ agent: "claude", role: "host", phase: "open", id: "s1" }]);
  });

  it("the presence beat and the work beat are kept apart: opening does not hide a start, a stop does not reopen", () => {
    const opened = hostTrace({}, open(), "open", 0);
    expect(hostTrace(opened.beats, { session_id: "s1", tool_name: "Bash" }, "pre", 1).lines[0]).toMatchObject({ phase: "start" });
    const stopped = hostTrace({ ...opened.beats, s1: 0 }, { session_id: "s1" }, "stop", 2);
    expect(hostTrace(stopped.beats, open(), "open", 3).lines).toEqual([]);
  });

  it("a session closes, and opening it again is noted at once", () => {
    const opened = hostTrace({}, open(), "open", 0);
    const closed = hostTrace(opened.beats, { session_id: "s1" }, "close", 5);
    expect(closed.lines).toEqual([{ agent: "claude", role: "host", phase: "close", id: "s1" }]);
    expect(hostTrace(closed.beats, open(), "open", 6).lines).toHaveLength(1);
  });
});

describe("hostPid: the host above the hook's shells (HU-4756)", () => {
  const hookSh = "sh -c if command -v kj-hook >/dev/null 2>&1; then kj-hook presence; fi";
  const table = {
    100: { ppid: 90, cmd: "node /usr/lib/node_modules/@karajan-family/code/bin/kj-hook.js presence" },
    90: { ppid: 80, cmd: hookSh },
    80: { ppid: 70, cmd: "node /usr/bin/gemini" },
    70: { ppid: 1, cmd: "-bash" },
  };
  const read = (p) => { if (!table[p]) throw new Error("gone"); return table[p]; };

  it("climbs past the hook's own sh and node, and stops at the host even when the host is node", () => {
    expect(hostPid({ from: 100, read })).toBe(80);
    expect(hostPid({ from: 100, read: (p) => (p === 90 ? { ppid: 80, cmd: "sh -c kj sentinel hook presence" } : read(p)) })).toBe(80);
  });

  it("names no pid when the chain cannot be read (no /proc, no ps) or holds only the hook", () => {
    expect(hostPid({ from: 100, read: () => { throw new Error("no ps"); } })).toBeUndefined();
    expect(hostPid({ from: 100, read: () => ({ ppid: 1, cmd: hookSh }) })).toBeUndefined();
  });
});

describe("the presence hook", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "presence-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("traceHost notes the host's pid, the first process above the hook's shells", () => {
    traceHost(root, { session_id: "s1", cwd: root }, "open", Date.parse("2026-11-21T12:00:00Z"));
    expect(rowsOf(root)).toEqual([{ at: "2026-11-21T12:00:00.000Z", agent: "claude", role: "host", phase: "open", id: "s1", pid: hostPid() }]);
  });

  // HU-4756: kj harden wires the guard inside `if ...; then kj-hook presence; fi`, a sh -c that
  // does not exec it, so the guard's parent is that sh and it dies as soon as the hook ends.
  it.runIf(process.platform !== "win32")("run the way kj harden wires it, the pid is not the hook's sh and outlives it", () => {
    const res = spawnSync("sh", ["-c", `if true; then "${process.execPath}" "${PRESENCE}"; fi`], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "s8", cwd: root }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, KJ_POLICY_ROLE: "" },
    });
    const [row] = rowsOf(root);
    expect(row.pid).not.toBe(res.pid);
    expect(row.pid).toBe(process.pid); // the process that ran the hook, as the host does
  });

  const run = (event) => spawnSync(process.execPath, [PRESENCE], {
    input: JSON.stringify({ hook_event_name: event, session_id: "s9", cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, KJ_POLICY_ROLE: "" },
    encoding: "utf8",
  });

  it("opens on a prompt and closes on the session's end, silent and never failing", () => {
    for (const event of ["UserPromptSubmit", "SessionEnd"]) {
      const res = run(event);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe("");
    }
    expect(rowsOf(root).map((r) => r.phase)).toEqual(["open", "close"]);
  });

  it("is stage wiring: kj harden installs it, the checks never demand it", () => {
    const events = SENTINEL_WIRING.filter((e) => e.script === "presence.mjs").map((e) => e.event);
    expect(events).toEqual(["SessionStart", "UserPromptSubmit", "SessionEnd"]);
    expect(GOVERNING_WIRING.some((e) => e.script === "presence.mjs")).toBe(false);
    expect(Object.hasOwn(SENTINEL_GUARDS, "presence")).toBe(true);
    installSentinelHooks({ projectDir: root, logger: { info() {}, warn() {} } });
    const { hooks } = JSON.parse(readFileSync(join(root, ".claude", "settings.local.json"), "utf8"));
    for (const event of ["UserPromptSubmit", "SessionEnd"]) expect(JSON.stringify(hooks[event])).toContain("presence");
  });
});
