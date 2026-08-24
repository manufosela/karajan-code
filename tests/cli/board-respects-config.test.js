// KJC-BUG-0152 (issue #1427, reported by dfosela) — `kj board` with no action
// starts a persistent HTTP server. Doing it while hu_board.enabled is false
// contradicts `kj doctor`, which reports the board as skipped: two commands
// saying opposite things about the same config, and a background process the
// user never asked for.
//
// This drives the REAL binary, not a helper: if the wiring is wrong the test
// fails (and, tellingly, a stray server would be left behind — which is exactly
// the bug). No mock can prove that.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const KJ = path.resolve("bin/kj.js");
let dir, home;

// Hermetic: its own KARAJAN_HOME, so the test never depends on (or touches) the
// developer's global config — a local config alone makes kj stop earlier.
const run = (...args) =>
  spawnSync(process.execPath, [KJ, ...args], { cwd: dir, encoding: "utf8", timeout: 60_000, env: { ...process.env, KARAJAN_HOME: home } });
const runBoard = (...args) => run("board", ...args);
const flat = (res) => `${res.stdout}${res.stderr}`.replaceAll(/\s+/g, " ");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-cfg-"));
  home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "kj.config.yml"), "hu_board:\n  enabled: true\n  port: 4000\n");
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), "hu_board:\n  enabled: false\n  port: 4000\n  auto_start: false\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj board with hu_board.enabled: false", () => {
  it("refuses to start, says why, and exits non-zero instead of opening a port", () => {
    const res = runBoard();
    expect(res.status).not.toBe(0);
    expect(flat(res)).toMatch(/hu_board\.enabled es false/);
    expect(flat(res)).toMatch(/--force/); // the way out is named, not hidden
    expect(flat(res)).not.toMatch(/HU Board started/); // the whole point: no daemon
  }, 70_000);

  it("stop stays allowed, so a leftover daemon can always be cleaned up", () => {
    expect(flat(runBoard("stop"))).not.toMatch(/hu_board\.enabled es false/);
  }, 70_000);

  it("status stays allowed: asking is never the surprise", () => {
    expect(flat(runBoard("status"))).not.toMatch(/hu_board\.enabled es false/);
  }, 70_000);

  // Caught by CI: gating everything-but-stop-and-status also blocked `cleanup`, which tidies up
  // and starts nothing. Only the action that brings a server up is gated.
  it("cleanup stays allowed too — it starts nothing", () => {
    expect(flat(runBoard("cleanup"))).not.toMatch(/hu_board\.enabled es false/);
  }, 70_000);

  it("--help says the bare command starts a server, which is what surprised the reporter", () => {
    expect(flat(run("board", "--help"))).toMatch(/SIN acción arranca un servidor persistente/i);
  }, 70_000);
});
