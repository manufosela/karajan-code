import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordDemo, sanitizeWhy } from "../../apps/landing/scripts/record-factory-demo.mjs";

// KJL-TSK-0157 (ADR 0052): the factory demo is a real task, rebuilt from the files kj
// already writes, with the board's own parsers, and with nothing personal in it.
const SID = "6d9a17f7-9cbb-4cb0-9130-1ef508ec982d";
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "kj-demo-"));
  const lane = join(dir, ".kj", "worktrees", "kj-stage", ".karajan");
  mkdirSync(join(dir, ".karajan", "traces"), { recursive: true });
  mkdirSync(join(lane, "traces"), { recursive: true });
  mkdirSync(join(lane, "reviews"), { recursive: true });
  writeFileSync(join(dir, ".karajan", "traces", "cards.jsonl"), jsonl([
    { at: "2026-11-11T10:00:00Z", action: "add", id: "HU-1", title: "the task", status: "pending", lane: "kj-stage" },
    { at: "2026-11-11T10:05:00Z", action: "move", id: "HU-1", status: "running", lane: "kj-stage" },
    { at: "2026-11-11T10:06:00Z", action: "add", id: "HU-9", title: "elsewhere", status: "pending", lane: "other" },
    { at: "2026-11-11T10:20:00Z", action: "move", id: "HU-1", status: "done", lane: "kj-stage" },
  ]));
  writeFileSync(join(lane, "traces", "denials.jsonl"), jsonl([
    { at: "2026-11-11T09:00:00Z", tool: "Bash", why: "old denial", input: { command: "secret" } },
    { at: "2026-11-11T10:10:00Z", tool: "Bash", why: "cd in /home/someone/repo/x is not checkable\nsecond line", input: { command: "cd /home/someone" } },
  ]));
  writeFileSync(join(lane, "traces", "agent-activity.jsonl"), jsonl([
    { at: "2026-11-11T10:07:00Z", agent: "claude", role: "host", phase: "start", id: SID, tool: "Edit" },
    { at: "2026-11-11T10:30:00Z", agent: "claude", role: "host", phase: "start", id: SID, tool: "Edit" },
  ]));
  writeFileSync(join(lane, "reviews", "a.json"), JSON.stringify({ verdict: "rejected", reviewer: "codex", diffHash: "abc", timestamp: "2026-11-11T10:12:00Z" }));
  return dir;
}

describe("recordDemo", () => {
  const demo = recordDemo({ projectDir: project(), task: "HU-1", lanes: ["main", "kj-stage"] });

  it("spans the task from running to done and names its lanes", () => {
    expect(demo).toMatchObject({ task: "HU-1", title: "the task", from: "2026-11-11T10:05:00Z", to: "2026-11-11T10:20:00Z", lanes: ["main", "kj-stage"] });
  });

  it("opens on what each lane had before the task started", () => {
    const stage = demo.state.lanes.find((l) => l.lane === "kj-stage");
    expect(stage.denial).toMatchObject({ tool: "Bash", why: "old denial" });
    expect(stage.cards.map((c) => c.id)).toEqual(["HU-1"]);
    expect(demo.state.lanes.map((l) => l.lane)).toEqual(["main", "kj-stage"]);
  });

  it("keeps the window's events in order, each with its lane, and only from those lanes", () => {
    expect(demo.events.map((e) => [e.type, e.lane])).toEqual([
      ["card", "kj-stage"], ["agent-activity", "kj-stage"], ["sentinel-deny", "kj-stage"], ["review-verdict", "kj-stage"], ["card", "kj-stage"],
    ]);
  });

  it("carries no session id, no path and no command", () => {
    const text = JSON.stringify(demo);
    expect(text).not.toContain(SID);
    expect(text).not.toMatch(/\/home\/|"command"|secret/);
    expect(demo.events.find((e) => e.type === "agent-activity").id).toBe("session-1");
  });
});

describe("recordDemo of a card that never ran", () => {
  it("starts the window when the card was added", () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-demo-"));
    mkdirSync(join(dir, ".karajan", "traces"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "traces", "cards.jsonl"), jsonl([
      { at: "2026-11-11T10:00:00Z", action: "add", id: "HU-2", title: "straight to done", status: "pending", lane: "main" },
      { at: "2026-11-11T10:30:00Z", action: "move", id: "HU-2", status: "done", lane: "main" },
    ]));
    expect(recordDemo({ projectDir: dir, task: "HU-2", lanes: ["main"] })).toMatchObject({ from: "2026-11-11T10:00:00Z", to: "2026-11-11T10:30:00Z" });
  });
});

describe("sanitizeWhy", () => {
  it("drops absolute paths and refuses an email", () => {
    expect(sanitizeWhy("no write to /tmp/a/b.js here")).toBe("no write to … here");
    expect(() => sanitizeWhy("mail someone@example.com")).toThrow(/email/);
  });
});
