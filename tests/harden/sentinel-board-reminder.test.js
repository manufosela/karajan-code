// KJC-TSK-0774 — when a turn ends green with cards closed, the Stop hook tells
// the user where to look: the board URL if it runs, else how to start it.
// The closing is the REAL update_card (or kj hu move) the PostToolUse saw.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, post, stop, statePath, home;
const env = () => ({ ...process.env, KJ_ALLOW_IDENTITY: "1", KARAJAN_HOME: home });
const closeCard = (cardId) => spawnSync("node", [post], {
  input: JSON.stringify({ session_id: "s1", tool_name: "mcp__planning-game__update_card", tool_input: {}, tool_response: { content: [{ text: JSON.stringify({ card: { cardId, status: "To Validate" } }) }] } }),
  encoding: "utf8", cwd: dir, env: env(),
});
const endTurn = () => spawnSync("node", [stop], { input: JSON.stringify({ session_id: "s1" }), encoding: "utf8", cwd: dir, env: env() });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-reminder-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  stop = path.join(dir, ".karajan", "harness", "stop.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe("board reminder on a green turn", () => {
  it("a closing update_card records the card; the Stop hook names it and says how to start the board when it is not running; then forgets it", () => {
    expect(closeCard("KJC-TSK-0042").status).toBe(0);
    expect(state().sessions.s1.closed_cards).toEqual(["KJC-TSK-0042"]);
    const r = endTurn();
    expect(r.status).toBe(0);
    const msg = JSON.parse(r.stdout.trim().split("\n").at(-1)).systemMessage;
    expect(msg).toContain("KJC-TSK-0042");
    expect(msg).toContain("kj board start");
    expect(state().sessions.s1.closed_cards).toEqual([]);
    expect(endTurn().stdout.trim()).toBe("");
  });

  it("with the board running (live pid file) the reminder carries the URL", () => {
    fs.writeFileSync(path.join(home, "hu-board.pid"), String(process.pid));
    closeCard("KJC-BUG-0007");
    const msg = JSON.parse(endTurn().stdout.trim().split("\n").at(-1)).systemMessage;
    expect(msg).toContain("KJC-BUG-0007");
    expect(msg).toContain("http://localhost:4000/#governance");
    expect(msg).not.toContain("kj board start");
  });
});
