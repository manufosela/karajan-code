// KJC-BUG-0216 (issue #1807) — el gate rag-first exigia una respuesta del RAG
// sobre CUALQUIER fichero tocado. Para un .astro, un .php o cualquier lenguaje
// sin adapter eso es imposible: el indexador nunca lo toma, se consulte lo que
// se consulte. La unica salida era dejar KJ_ALLOW_NO_RAG puesta para siempre,
// que apaga el gate entero y borra la diferencia entre no pude y no quise.
//
// El kj de este test es un doble en el PATH: la suite no puede depender del kj
// que haya instalado en la maquina (verde en local, rojo en CI).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, bin;
const hook = (script, payload, env = {}) => spawnSync("node", [script], {
  input: JSON.stringify({ session_id: "s1", ...payload }),
  encoding: "utf8", cwd: dir,
  env: { ...process.env, KJ_ALLOW_IDENTITY: "1", PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env },
});
const edit = (rel) => hook(gate, { tool_name: "Edit", tool_input: { file_path: path.join(dir, rel) } });
/** Un `kj` de mentira cuyo `rag covers` decide por la extension. */
const fakeKj = (body) => {
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "kj");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-unindexable-"));
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "x\n");
  fs.writeFileSync(path.join(dir, "src", "Page.astro"), "<h1>x</h1>\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git add -A && git commit -q -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  // `rag covers`: exit 1 (no puede responder) para lo que no es .js.
  fakeKj('case "$*" in *covers*.js*) echo \'{"state":"indexed","canAnswer":true}\'; exit 0 ;; *covers*) echo \'{"state":"not-indexable","canAnswer":false,"reason":"no language adapter covers .astro"}\'; exit 1 ;; *) exit 0 ;; esac');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rag-first × un fichero que el indice NO puede tener", () => {
  it("el .astro pasa sin escape, y el gate dice por que en vez de pedir lo imposible", () => {
    const res = edit("src/Page.astro");
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/no language adapter covers \.astro/);
    expect(res.stderr).toMatch(/no se te exige/);
  });

  it("un fichero que SI esta indexado sigue exigiendo la consulta", () => {
    const res = edit("src/a.js");
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/consulta antes de tocarlo/);
  });

  it("si kj no puede responder la pregunta, el gate bloquea: el lado seguro", () => {
    fakeKj("exit 3");
    expect(edit("src/Page.astro").status).toBe(2);
  });

  it("un indice vacio o por detras SI tiene arreglo, asi que sigue bloqueando", () => {
    for (const state of ["index-empty", "stale"]) {
      fakeKj(`echo '{"state":"${state}","canAnswer":false,"reason":"kj rag index"}'; exit 1`);
      expect(edit("src/Page.astro").status, state).toBe(2);
    }
  });

  it("sin kj alcanzable tampoco se abre la mano", () => {
    // PATH SOLO con el bin del test (git enlazado dentro): el kj instalado en la
    // maquina no puede decidir el resultado de una prueba.
    fs.rmSync(path.join(bin, "kj"));
    fs.symlinkSync(execSync("command -v git", { encoding: "utf8", shell: "/bin/sh" }).trim(), path.join(bin, "git"));
    const res = spawnSync(process.execPath, [gate], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, "src", "Page.astro") } }),
      encoding: "utf8", cwd: dir,
      env: { ...process.env, KJ_ALLOW_IDENTITY: "1", PATH: bin },
    });
    expect(res.status).toBe(2);
  });
});
