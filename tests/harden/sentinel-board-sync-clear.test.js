// KJC-TSK-0765 (parte 2) — el pendiente de mover se LIMPIA con el registro
// real en el tracker, visto por el PostToolUse: la tool call MCP update_card
// del Planning Game con un estado de cierre para ESA card (el Sentinel ve las
// tool calls MCP de Claude Code), o `kj hu move` para el HU Board.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, post, statePath;
const env = { KJ_ALLOW_IDENTITY: "1" };
const hook = (script, payload) => spawnSync("node", [script], { input: JSON.stringify({ session_id: "s1", ...payload }), encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const seed = (...cards) => {
  const st = fs.existsSync(statePath) ? state() : {};
  st.sessions = { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, pending_moves: cards.map((card, i) => ({ card, pr: 100 + i, at: 1 })) } };
  fs.writeFileSync(statePath, JSON.stringify(st));
};
const updateCard = (cardId, status, tool = "mcp__planning-game-personal__update_card") =>
  hook(post, { tool_name: tool, tool_input: { updates: { status } }, tool_response: JSON.stringify({ message: "Card updated successfully", card: { cardId, status } }) });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-clear-"));
  // user.email/name explicitos: el runner de CI no tiene config global de git.
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("board-sync — limpieza del pendiente", () => {
  it("update_card del PG con estado de cierre para ESA card limpia su pendiente (y solo el suyo)", () => {
    seed("KJC-TSK-0042", "KJC-BUG-0007");
    expect(updateCard("KJC-TSK-0042", "To Validate").status).toBe(0);
    expect(state().sessions.s1.pending_moves.map((p) => p.card)).toEqual(["KJC-BUG-0007"]);
    expect(updateCard("KJC-BUG-0007", "Fixed").status).toBe(0);
    expect(state().sessions.s1.pending_moves).toHaveLength(0);
    expect(hook(gate, { tool_name: "Bash", tool_input: { command: "git commit -m x" } }).status).toBe(0);
  });

  it("la respuesta MCP real llega como content[].text con el JSON ESCAPADO: tambien limpia (hallado en vivo)", () => {
    seed("KJC-TSK-0042");
    const mcpShape = { content: [{ type: "text", text: JSON.stringify({ message: "Card updated successfully", card: { cardId: "KJC-TSK-0042", status: "To Validate" } }) }] };
    hook(post, { tool_name: "mcp__planning-game-personal__update_card", tool_input: { updates: { status: "To Validate" } }, tool_response: mcpShape });
    expect(state().sessions.s1.pending_moves).toHaveLength(0);
  });

  it("un update_card que NO cierra (In Progress, sin estado) no limpia nada; otro proyecto/tool tampoco", () => {
    seed("KJC-TSK-0042");
    updateCard("KJC-TSK-0042", "In Progress");
    updateCard("KJC-TSK-0042", undefined);
    hook(post, { tool_name: "mcp__planning-game-personal__get_card", tool_input: {}, tool_response: JSON.stringify({ card: { cardId: "KJC-TSK-0042", status: "To Validate" } }) });
    expect(state().sessions.s1.pending_moves).toHaveLength(1);
  });

  it("kj hu move <card> a un estado de cierre limpia el pendiente (HU Board); un pendiente sin card se limpia con cualquier cierre", () => {
    seed("KJC-TSK-0042", "KJC-TSK-0043");
    hook(post, { tool_name: "Bash", tool_input: { command: "kj hu move KJC-TSK-0042 to-validate" }, tool_response: { stdout: "moved KJC-TSK-0042 -> to-validate" } });
    expect(state().sessions.s1.pending_moves.map((p) => p.card)).toEqual(["KJC-TSK-0043"]);
    // Un pendiente SIN card (rama sin ref) no se puede casar: cualquier cierre lo limpia.
    seed(null);
    updateCard("KJC-TSK-0099", "Done&Validated");
    expect(state().sessions.s1.pending_moves).toHaveLength(0);
  });

  // KJC-BUG-0154, mitad (2): «HU "X" not found» no contiene error ni fail, así que un move
  // que no movió NADA limpiaba el pendiente — vía válida para descartar uno legítimo sin
  // tocar el tracker. Un movimiento fantasma no limpia.
  it("kj hu move de una HU inexistente NO limpia el pendiente", () => {
    seed("KJC-TSK-0042");
    hook(post, { tool_name: "Bash", tool_input: { command: "kj hu move KJC-TSK-0042 done" }, tool_response: { stdout: 'HU "KJC-TSK-0042" not found — see kj hu list' } });
    expect(state().sessions.s1.pending_moves).toHaveLength(1);
  });
});
