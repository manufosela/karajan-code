// KJC-TSK-1457 (ADR 0050, point 5): kj hu add and kj hu move leave one line in the lane's
// harness, whatever board holds the cards, so kj stage draws the factory's task board from
// real events only. The MCP's kj_hu runs this same command, so it leaves the same line.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { huCommand } from "../../src/commands/hu.js";
import { CARDS_FILE, traceCard } from "../../src/hu/card-trace.js";

let dir;
let warnings;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-card-trace-"));
  warnings = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation((m) => warnings.push(String(m)));
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const local = { boardConfig: async () => ({ backend: "local" }), who: "dev", skills: async () => ({ skills: [] }) };
const run = (action, args, deps = local) => huCommand({ config: { projectDir: dir }, action, args, flags: { json: true }, deps });
const trace = () => fs.readFileSync(path.join(dir, CARDS_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("the card trace of kj hu", () => {
  it("kj hu add leaves the new card, pending, with its id and title", async () => {
    await run("add", ["Login with SSO"]);
    expect(trace()).toEqual([{ at: expect.any(String), action: "add", id: "HU-0001", title: "Login with SSO", status: "pending" }]);
  });

  // KJC-BUG-0527: the sandbox leaves .karajan/traces writable, not .karajan/harness.
  it("lands in .karajan/traces, not in the harness", async () => {
    await run("add", ["Login with SSO"]);
    expect(CARDS_FILE).toBe(".karajan/traces/cards.jsonl");
    expect(fs.existsSync(path.join(dir, ".karajan", "traces", "cards.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".karajan", "harness"))).toBe(false);
  });

  it("kj hu move leaves the card and where it went", async () => {
    await run("add", ["Login with SSO"]);
    await run("move", ["HU-0001", "running"]);
    expect(trace()[1]).toEqual({ at: expect.any(String), action: "move", id: "HU-0001", status: "running" });
  });

  it("a move queued without network says it is queued, not that the card is already there", () => {
    traceCard(dir, { action: "move", id: "HU-42", status: "done", queued: true }, (m) => warnings.push(m));
    expect(trace()[0]).toEqual({ at: expect.any(String), action: "move", id: "HU-42", status: "done", queued: true });
  });

  it("a card of the shared board leaves the id its board gave it", async () => {
    const manager = {
      capabilities: { tier: true },
      list: async () => [],
      create: async (args) => ({ short_id: "HU-42", status: "pending", title: args.title }),
    };
    await run("add", ["Login with SSO"], { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), manager, writeMirror: async () => {} });
    expect(trace()).toMatchObject([{ action: "add", id: "HU-42", title: "Login with SSO", status: "pending" }]);
  });

  it("a traces folder it cannot write never stops the card: it is created and the lost trace is said", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "traces"), "a file where the folder should be");
    const r = await run("add", ["Login with SSO"]);
    expect(r.short_id).toBe("HU-0001");
    expect(warnings.join("\n")).toMatch(/card trace/);
  });

  // KJC-BUG-0546: a lane is swept after its merge, and its trace with it: a card closed there
  // stayed running in kj stage. The line lands in the main checkout, naming its lane.
  it("from a lane, it lands in the main checkout's trace with the lane's name", () => {
    const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "root");
    const lane = path.join(dir, ".kj", "worktrees", "feat-x");
    git("worktree", "add", "-q", lane);
    traceCard(lane, { action: "move", id: "HU-7", status: "done" }, (m) => warnings.push(m));
    expect(trace()).toEqual([{ at: expect.any(String), action: "move", id: "HU-7", status: "done", lane: "feat-x" }]);
    expect(fs.existsSync(path.join(lane, CARDS_FILE))).toBe(false);
  });

  it("keeps the title short: the wall shows a short title, never the whole story", () => {
    traceCard(dir, { action: "add", id: "HU-1", title: "x".repeat(200), status: "pending" }, (m) => warnings.push(m));
    expect(trace()[0].title).toHaveLength(80);
  });
});
