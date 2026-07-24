// KJC-TSK-0685 — Karajan does not run without a board (user rule, no
// "none"): init/env-install verify there is an OPERATIONAL access path to
// the declared board — bundled hu-board, a configured MCP, or an API token.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBoardAccess } from "../../src/environment/board-access.js";

let dir, home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-p-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-h-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("verifyBoardAccess", () => {
  it("hu-board is always operational — it ships with kj", () => {
    expect(verifyBoardAccess({ config: {}, projectDir: dir, home, env: {} }))
      .toMatchObject({ ok: true });
  });

  it("planning-game requires its MCP in a host agent config", () => {
    const missing = verifyBoardAccess({ config: { state_backend: "planning-game" }, projectDir: dir, home, env: {} });
    expect(missing.ok).toBe(false);
    expect(missing.needed.join(" ")).toMatch(/planning-game/);

    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "planning-game-personal": { command: "x" } } }));
    expect(verifyBoardAccess({ config: { state_backend: "planning-game" }, projectDir: dir, home, env: {} }).ok).toBe(true);
  });

  it("external + MCP of the named board in the project .mcp.json passes", () => {
    fs.writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { linear: { url: "https://mcp.linear.app" } } }));
    const r = verifyBoardAccess({ config: { state_backend: "external", board: { name: "Linear" } }, projectDir: dir, home, env: {} });
    expect(r.ok).toBe(true);
    expect(r.via).toMatch(/MCP/);
  });

  it("external + conventional API token env passes", () => {
    const r = verifyBoardAccess({
      config: { state_backend: "external", board: { name: "Linear" } },
      projectDir: dir, home, env: { LINEAR_API_KEY: "lin_xxx" },
    });
    expect(r.ok).toBe(true);
    expect(r.via).toMatch(/LINEAR_API_KEY/);
  });

  it("external + declared board.token_env passes when exported", () => {
    const r = verifyBoardAccess({
      config: { state_backend: "external", board: { name: "MiBoard", token_env: "MIBOARD_TOKEN" } },
      projectDir: dir, home, env: { MIBOARD_TOKEN: "t" },
    });
    expect(r.ok).toBe(true);
  });

  it("external with NO access path fails with the exact steps", () => {
    const r = verifyBoardAccess({ config: { state_backend: "external", board: { name: "Trello" } }, projectDir: dir, home, env: {} });
    expect(r.ok).toBe(false);
    expect(r.needed.join("\n")).toMatch(/Trello MCP/i);
    expect(r.needed.join("\n")).toMatch(/TRELLO/);
  });

  it("external without a board.name fails asking for it", () => {
    const r = verifyBoardAccess({ config: { state_backend: "external" }, projectDir: dir, home, env: {} });
    expect(r.ok).toBe(false);
    expect(r.needed.join(" ")).toMatch(/board.name/);
  });
});
