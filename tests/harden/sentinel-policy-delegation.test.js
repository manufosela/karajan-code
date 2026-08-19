// KJC-TSK-0734 PL-B — el PRETOOL delega en el motor: con policy.yml
// presente, kj policy eval --strict decide (exit 2 = deny, contrato PL-A).
// class=security no tiene escape; exit 1 (policy invalida) falla ABIERTO
// aqui (bloquear toda tool call por un typo seria un DoS de la sesion — el
// gate de commit falla cerrado); sin policy.yml no se paga el spawn.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, statePath;
const run = (script, payload, env = {}) =>
  spawnSync("node", [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
const editTool = (file) => ({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: file } });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

const fakeKj = (body) => {
  const bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}` };
};
const DENY = '{"decision":"deny","rule_id":"roles.coder.write.deny","enforcement":"deny","reason":"src/a.js esta denegado"}';
const DENY_SEC = '{"decision":"deny","rule_id":"defaults.supervisor.write","enforcement":"deny","class":"security","reason":"nombra ficheros del supervisor"}';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentpol-"));
  execSync(
    "git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pretooluse delega en kj policy eval --strict (PL-B)", () => {
  it("deny del motor bloquea la tool call con la regla en el mensaje", () => {
    const env = fakeKj(`echo '${DENY}'; exit 2`);
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), env);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/roles\.coder\.write\.deny/);
  });

  it("KJ_ALLOW_POLICY=1 exime un deny NO-security y queda registrado", () => {
    const env = fakeKj(`echo '${DENY}'; exit 2`);
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), { ...env, KJ_ALLOW_POLICY: "1" });
    expect(res.status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_POLICY")).toBe(true);
  });

  it("class=security NO tiene escape — ni con KJ_ALLOW_POLICY", () => {
    const env = fakeKj(`echo '${DENY_SEC}'; exit 2`);
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), { ...env, KJ_ALLOW_POLICY: "1" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/security/);
  });

  it("un Bash mutador tambien pasa por el motor", () => {
    const env = fakeKj(`echo '${DENY}'; exit 2`);
    const res = run(gate, { session_id: "s1", tool_name: "Bash", tool_input: { command: "touch x.js" } }, env);
    expect(res.status).toBe(2);
  });

  it("kj inejecutable con policy declarada = deny nombrando la red caida (catch de codex, doctrina BUG-0095)", () => {
    // Un kj que muere por señal deja spawnSync con status null — el mismo
    // resultado observable que un binario ausente o roto en mitad del PATH.
    const env = fakeKj("kill -9 $$");
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), env);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/kj no es ejecutable/);
  });

  it("exit 1 (evaluacion fallida) = fail CLOSED con remedio — solo la excepcion humana abre", () => {
    const env = fakeKj(`echo 'policy.yml invalida'; exit 1`);
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), env);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/kj policy check|KJ_ALLOW_POLICY/);
    const escaped = run(gate, editTool(path.join(dir, "src", "a.js")), { ...env, KJ_ALLOW_POLICY: "1" });
    expect(escaped.status).toBe(0);
    expect(state().escape_events.some((e) => e.escape === "KJ_ALLOW_POLICY")).toBe(true);
  });

  it("el rol que actua viaja: KJ_POLICY_ROLE=reviewer llega como --role reviewer (PL-C)", () => {
    const argsFile = path.join(dir, "kj-args.txt");
    const env = fakeKj(`echo "$@" > ${argsFile}; exit 0`);
    run(gate, editTool(path.join(dir, "src", "a.js")), { ...env, KJ_POLICY_ROLE: "reviewer" });
    expect(fs.readFileSync(argsFile, "utf8")).toContain("--role reviewer");
  });

  it("sin policy.yml no se consulta el motor (cero spawn, cero coste)", () => {
    fs.rmSync(path.join(dir, ".karajan", "policy.yml"));
    const env = fakeKj(`echo '${DENY}'; exit 2`);
    const res = run(gate, editTool(path.join(dir, "src", "a.js")), env);
    expect(res.status).toBe(0);
  });
});
