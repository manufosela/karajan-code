// KJC-TSK-0709 — never hu-board silently when alternatives are reachable:
// env install detects boards, asks in interactive installs, PERSISTS the
// choice, and in headless runs names the default and how to change it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectAvailableBoards } from "../../src/environment/board-access.js";
import { pickStateBackend } from "../../src/environment/board-select.js";

let dir, home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bsel-prj-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bsel-home-"));
  // Isolate the GLOBAL kj config: the developer's real one may declare a
  // state_backend, and "declared" must come from files under test only.
  process.env.KARAJAN_HOME = path.join(home, "karajan-home");
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "planning-game-personal": { command: "pg" } } }));
});
afterEach(() => {
  delete process.env.KARAJAN_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const quiet = { info() {} };

describe("detectAvailableBoards", () => {
  it("always offers hu-board and adds detected MCPs and token boards", () => {
    const boards = detectAvailableBoards({ projectDir: dir, home, env: { LINEAR_API_KEY: "x" } });
    const values = boards.map((b) => b.value);
    expect(values[0]).toBe("hu-board");
    expect(values).toContain("planning-game");
    expect(values).toContain("external:linear");
  });
});

describe("pickStateBackend", () => {
  it("a state_backend declared in the project config FILE never asks (the merged default cannot count)", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), "state_backend: planning-game\n");
    const res = await pickStateBackend({ projectDir: dir, home, logger: quiet });
    expect(res).toMatchObject({ backend: "planning-game", source: "declared" });
  });

  it("interactive: asks, returns the choice and PERSISTS it to kj.config.yml", async () => {
    const wizard = { select: async (_q, opts) => opts.find((o) => o.value === "planning-game").value };
    const res = await pickStateBackend({ projectDir: dir, home, env: {}, wizard, isTTY: true, logger: quiet });
    expect(res).toMatchObject({ backend: "planning-game", source: "chosen" });
    const yml = fs.readFileSync(path.join(dir, ".karajan", "kj.config.yml"), "utf8");
    expect(yml).toMatch(/state_backend:\s*planning-game/);
  });

  it("interactive external choice persists board.name too", async () => {
    const wizard = { select: async (_q, opts) => opts.find((o) => o.value === "external:linear").value };
    const res = await pickStateBackend({ projectDir: dir, home, env: { LINEAR_API_KEY: "x" }, wizard, isTTY: true, logger: quiet });
    expect(res).toMatchObject({ backend: "external", boardName: "linear" });
    const yml = fs.readFileSync(path.join(dir, ".karajan", "kj.config.yml"), "utf8");
    expect(yml).toMatch(/state_backend:\s*external/);
    expect(yml).toMatch(/name:\s*linear/);
  });

  it("headless with alternatives: defaults to hu-board but SAYS so and how to change", async () => {
    const lines = [];
    const res = await pickStateBackend({ projectDir: dir, home, env: {}, wizard: null, isTTY: false, logger: { info: (m) => lines.push(m) } });
    expect(res).toMatchObject({ backend: "hu-board", source: "default-informed" });
    expect(lines.join("\n")).toMatch(/state_backend/);
    expect(lines.join("\n")).toMatch(/planning-game/i);
  });

  it("nothing else detectable: silent default, no noise", async () => {
    fs.rmSync(path.join(home, ".claude.json"));
    const lines = [];
    const res = await pickStateBackend({ projectDir: dir, home, env: {}, logger: { info: (m) => lines.push(m) } });
    expect(res).toMatchObject({ backend: "hu-board", source: "default" });
    expect(lines).toEqual([]);
  });
});
