// GOV-F (KJC-TSK-0768) — un escape KJ_ALLOW_* usado en tool-time no vive solo
// en sentinel-state.json: el Sentinel lo sella en el decision log vía
// `kj policy seal`. Best-effort CON aviso — un kj roto no encierra la sesión
// (el escape es justo la salida cuando kj no carga). Tests contra los hooks
// generados, con un `kj` falso en el PATH que registra sus argumentos.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, bin, argsLog;
const fakeKj = (exit = 0) => fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\necho "$@" >> ${argsLog}\nexit ${exit}\n`, { mode: 0o755 });
// Sin identidad declarada y con KJ_ALLOW_IDENTITY=1, cualquier git mutador pasa por el escape.
const push = () => spawnSync("node", [gate], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "git push" } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1", PATH: `${bin}:${process.env.PATH}` },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-escape-seal-"));
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin);
  argsLog = path.join(dir, "kj-args.log");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("escapes sellados en el decision log", () => {
  it("el escape usado invoca kj policy seal con su nombre y la tool, y la tool call pasa", () => {
    fakeKj(0);
    const r = push();
    expect(r.status).toBe(0);
    expect(fs.readFileSync(argsLog, "utf8")).toContain("policy seal --escape KJ_ALLOW_IDENTITY --tool Bash");
    expect(r.stderr).not.toMatch(/NO sellado/);
  });

  it("si kj policy seal falla, el escape sigue valiendo (exit 0) y stderr lo dice — nunca una sesión encerrada por el registro", () => {
    fakeKj(1);
    const r = push();
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/KJ_ALLOW_IDENTITY usado pero NO sellado/);
  });
});
