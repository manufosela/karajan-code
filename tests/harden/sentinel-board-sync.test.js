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

  it("bajo una tool call gh NO imprime el mensaje de exito: el estado del PR (gh pr view) es la señal autoritativa", () => {
    // Hallado en vivo en el primer merge con el gate activo: salida vacia, pendiente sin registrar.
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    const fakeGh = (st) => fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho '{"number":21,"state":"${st}"}'\n`, { mode: 0o755 });
    const silentMerge = (pr) => spawnSync("node", [post], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: `gh auth switch --user x && gh pr merge ${pr} --squash` }, tool_response: { stdout: "", stderr: "" } }),
      encoding: "utf8", cwd: dir, env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
    });
    fakeGh("OPEN");
    expect(silentMerge(21).status).toBe(0);
    expect(fs.existsSync(statePath) ? (state().sessions?.s1?.pending_moves ?? []) : []).toHaveLength(0);
    fakeGh("MERGED");
    expect(silentMerge(21).status).toBe(0);
    expect(state().sessions.s1.pending_moves[0]).toMatchObject({ card: "KJC-TSK-0042", pr: 21 });
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
    // KJC-BUG-0147: el mismo escape abre el push — una card de varios PRs es un plan legitimo.
    expect(bash("git push origin feat/x").status).toBe(2);
    expect(bash("KJ_ALLOW_BOARD=1 git push origin feat/x").status).toBe(0);
    const st = state();
    st.sessions.s1.pending_moves = [];
    fs.writeFileSync(statePath, JSON.stringify(st));
    expect(bash("git commit -m x").status).toBe(0);
    expect(endTurn().status).toBe(0);
  });

  it("la card es la de la rama HEAD del PR mergeado, no la de la rama en la que esta el arbol (KJC-BUG-0148)", () => {
    // Hallado en vivo: un merge lanzado desde el carril de otra card fijo la pendiente en la card equivocada.
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho '{"number":33,"state":"MERGED","headRefName":"feat/KJC-TSK-0099-other"}'\n`, { mode: 0o755 });
    const r = spawnSync("node", [post], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "gh pr merge 33 --merge" }, tool_response: { stdout: "", stderr: "" } }),
      encoding: "utf8", cwd: dir, env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(r.status).toBe(0);
    expect(state().sessions.s1.pending_moves[0]).toMatchObject({ card: "KJC-TSK-0099", pr: 33 });
    expect(state().sessions.s1.pending_moves[0].head).toBeUndefined();
  });

  // KJC-TSK-0868: el anfitrion escribiendo con otro coder declarado se REGISTRA
  // al cerrar el turno, una vez por sesion y sin bloquear. El guard solo
  // pregunta: quien sabe quien es el coder declarado es kj (fake aqui, porque
  // en CI no hay kj en el PATH).
  it("el panel se sella una vez por sesion al terminar, y nunca bloquea", () => {
    const st = { sessions: { s1: { edited_sources: ["src/a.js"], edited_tests: ["tests/a.test.js"], escapes: [], errors: [], blocks: 0 } } };
    fs.writeFileSync(statePath, JSON.stringify(st));
    const bin = path.join(dir, "panelbin");
    fs.mkdirSync(bin);
    const calls = path.join(dir, "panel-calls.txt");
    fs.writeFileSync(path.join(bin, "kj"), "#!/bin/sh\ncase \"$*\" in *panel-check*) echo panel-check >> " + calls + "; echo 'l panel: el coder declarado es codex y ha escrito claude';; esac\nexit 0\n", { mode: 0o755 });
    const env2 = { ...env, PATH: bin + ":" + process.env.PATH };
    const first = spawnSync("node", [stop], { input: JSON.stringify({ session_id: "s1" }), encoding: "utf8", cwd: dir, env: { ...process.env, ...env2 } });
    expect(first.status).toBe(0);
    expect(first.stderr).toMatch(/el coder declarado es codex/);
    expect(state().sessions.s1.panel_sealed).toBe(true);
    // Segunda vuelta: ya sellado, no se vuelve a preguntar.
    spawnSync("node", [stop], { input: JSON.stringify({ session_id: "s1" }), encoding: "utf8", cwd: dir, env: { ...process.env, ...env2 } });
    expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("sin card en la rama, el merge registra el PR y el remedio pide identificar la card", () => {
    execSync("git checkout -q -b sin-card", { cwd: dir });
    merged(7);
    expect(state().sessions.s1.pending_moves[0]).toMatchObject({ card: null, pr: 7 });
    expect(bash("git commit -m x").stderr).toMatch(/PR #7/);
  });

  // KJC-BUG-0198: una card partida en varias PRs no puede quedar bloqueada por
  // su primera mitad. El hecho lo comprueba kj preguntando a gh (su logica tiene
  // tests propios en tests/review/board-pending.test.js); aqui se prueba lo que
  // el guard OBSERVA, que es el contrato de kj sentinel board-gate.
  it("una card que kj declara arrastrada deja avanzar; sin respuesta de kj sigue bloqueando", () => {
    merged(12);
    expect(state().sessions.s1.pending_moves[0]).toMatchObject({ card: "KJC-TSK-0042", pr: 12 });
    // Sin poder preguntar (kj o gh no responden en este repo de prueba) se bloquea.
    expect(bash("git commit -m x").status).toBe(2);
    const bin = path.join(dir, "openbin");
    fs.mkdirSync(bin);
    const carried = '{"blocking":[],"carried":[{"card":"KJC-TSK-0042","why":"sigue entregandose en una PR abierta"}]}';
    fs.writeFileSync(path.join(bin, "kj"), "#!/bin/sh\necho '" + carried + "'\nexit 0\n", { mode: 0o755 });
    const allowed = bash("git commit -m x", { PATH: bin + ":" + process.env.PATH });
    expect(allowed.status).toBe(0);
    expect(allowed.stderr).toMatch(/arrastra KJC-TSK-0042/);
    // La pendiente NO se borra: el tablero sigue debiendo el movimiento, y el
    // Stop gate sigue impidiendo terminar el turno.
    expect(state().sessions.s1.pending_moves).toHaveLength(1);
    expect(endTurn().status).toBe(2);
  });

  it("kj que declara la pendiente BLOQUEANTE bloquea, aunque responda exit 0", () => {
    merged(12);
    const bin = path.join(dir, "blockbin");
    fs.mkdirSync(bin);
    const blocking = '{"blocking":[{"card":"KJC-TSK-0042","pr":12}],"carried":[]}';
    // exit 0 a proposito: lo que bloquea es la RESPUESTA, no el codigo de salida
    // (catch de la review: con exit 2 el test pasaba por el fallo del comando).
    fs.writeFileSync(path.join(bin, "kj"), "#!/bin/sh\necho '" + blocking + "'\nexit 0\n", { mode: 0o755 });
    const res = bash("git commit -m x", { PATH: bin + ":" + process.env.PATH });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/KJC-TSK-0042/);
  });
});
