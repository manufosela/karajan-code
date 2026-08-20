// KJC-TSK-0765 — board-sync gate: tras `gh pr merge` la card de la rama queda
// PENDIENTE DE MOVER en el tracker; mientras haya pendientes, el método no
// avanza (commit, push, nuevo PR, cierre de turno). Regla del usuario: NO
// PUEDE AVANZAR SI NO SE REGISTRA. Tests contra los hooks generados.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, stop, post, statePath;
const env = { KJ_ALLOW_IDENTITY: "1" }; // el identity lock tiene su propia suite
const bash = (command, extra = {}) =>
  spawnSync("node", [gate], {
    input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8", cwd: dir, env: { ...process.env, ...env, ...extra },
  });
// El registro del merge lo hace el PostToolUse, SOLO cuando gh confirma el merge.
const merged = (pr, ok = true) =>
  spawnSync("node", [post], {
    input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: `gh pr merge ${pr} --squash` }, tool_response: { stdout: ok ? `✓ Squashed and merged pull request #${pr}` : "", stderr: ok ? "" : "GraphQL: Pull request is not mergeable" } }),
    encoding: "utf8", cwd: dir, env: { ...process.env, ...env },
  });
const endTurn = () => spawnSync("node", [stop], { input: JSON.stringify({ session_id: "s1" }), encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-sync-"));
  execSync(
    "git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  stop = path.join(dir, ".karajan", "harness", "stop.mjs");
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("board-sync gate", () => {
  it("un merge CONFIRMADO por gh registra la card de la rama como pendiente de mover; un merge fallido no", () => {
    expect(bash("gh auth switch --user x && gh pr merge 12 --squash").status).toBe(0); // el gate deja pasar el merge
    expect(merged(12, false).status).toBe(0);
    expect(fs.existsSync(statePath) ? (state().sessions?.s1?.pending_moves ?? []) : []).toHaveLength(0);
    expect(merged(12).status).toBe(0);
    const pending = state().sessions.s1.pending_moves;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ card: "KJC-TSK-0042", pr: 12 });
  });

  it("con una card pendiente: commit, push, nuevo PR y cierre de turno se deniegan nombrando card+PR y el remedio", () => {
    merged(12);
    for (const cmd of ["git commit -m x", "git push origin feat/x", "gh pr create --title t", "gh pr merge 13"]) {
      const r = bash(cmd);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("KJC-TSK-0042");
      expect(r.stderr).toContain("12");
      expect(r.stderr).toMatch(/To Validate|Fixed|kj hu move/);
    }
    const turn = endTurn();
    expect(turn.status).toBe(2);
    expect(turn.stderr).toContain("KJC-TSK-0042");
    // Lectura y edicion siguen libres: el bloqueo es sobre AVANZAR.
    expect(bash("git status").status).toBe(0);
  });

  it("KJ_ALLOW_BOARD=1 es el escape auditado; y al desaparecer el pendiente todo vuelve a pasar", () => {
    merged(12);
    expect(bash("KJ_ALLOW_BOARD=1 git commit -m x").status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_BOARD")).toBe(true);
    const st = state();
    st.sessions.s1.pending_moves = [];
    fs.writeFileSync(statePath, JSON.stringify(st));
    expect(bash("git commit -m x").status).toBe(0);
    expect(endTurn().status).toBe(0);
  });

  it("sin card en la rama, el merge registra el PR y el remedio pide identificar la card", () => {
    execSync("git checkout -q -b sin-card", { cwd: dir });
    merged(7);
    expect(state().sessions.s1.pending_moves[0]).toMatchObject({ card: null, pr: 7 });
    expect(bash("git commit -m x").stderr).toMatch(/PR #7/);
  });
});
