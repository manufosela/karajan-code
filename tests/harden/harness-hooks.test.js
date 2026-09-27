// KJC-TSK-0710 — the TOOL gate: rules imposed at tool time, not remembered.
// Field case 2026-08-02: "instructions weren't enough — the environment must
// impose them" (the offending agent's own advice). Tests run the REAL script
// through the hooks protocol (JSON on stdin, exit 2 = block).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installHarnessHooks } from "../../src/harden/harness-hooks.js";

let dir, script;
const runHook = (payload, env = {}) =>
  spawnSync("node", [script], { input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, KJ_ALLOW_IDENTITY: "1", ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-toolgate-"));
  installHarnessHooks({ projectDir: dir });
  script = path.join(dir, ".karajan", "harness", "pretooluse.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pretooluse script", () => {
  it("blocks Write over an EXISTING file (use Edit), allows new files and the named escape", () => {
    const existing = path.join(dir, "a.js");
    fs.writeFileSync(existing, "x");
    const blocked = runHook({ tool_name: "Write", tool_input: { file_path: existing } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/Edit/);
    expect(runHook({ tool_name: "Write", tool_input: { file_path: path.join(dir, "new.js") } }).status).toBe(0);
    expect(runHook({ tool_name: "Write", tool_input: { file_path: existing } }, { KJ_ALLOW_WRITE: "1" }).status).toBe(0);
  });

  // KJC-BUG-0227 (issue #1841): el guard vigilaba CUALQUIER json.dump, aunque
  // el destino fuera un fichero temporal del agente fuera del repositorio, y no
  // honraba su propio escape cuando viajaba en el comando. Un guard que vigila
  // fuera de su jurisdiccion y ademas no se deja levantar ensena a rodearlo.
  it("no vigila fuera del repositorio: el scratchpad del agente no es asunto suyo", () => {
    const outside = path.join(os.tmpdir(), "kj-scratch-cfg.json");
    const cmd = { tool_name: "Bash", tool_input: { command: `python3 -c 'import json; json.dump(d, open("${outside}","w"))'` } };
    expect(runHook(cmd).status).toBe(0);
  });

  it("un enlace que apunta DENTRO del repo se sigue vigilando aunque viva fuera", () => {
    // Catch de la review: /tmp/link.json puede escribir en el repositorio.
    const link = path.join(os.tmpdir(), `kj-link-${Date.now()}`);
    fs.symlinkSync(dir, link);
    try {
      const cmd = { tool_name: "Bash", tool_input: { command: `python3 -c 'import json; json.dump(d, open("${link}/cfg.json","w"))'` } };
      expect(runHook(cmd).status).toBe(2);
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("sigue vigilando dentro del repositorio, por ruta absoluta o relativa", () => {
    const inside = path.join(dir, "cfg.json");
    expect(runHook({ tool_name: "Bash", tool_input: { command: `python3 -c 'import json; json.dump(d, open("${inside}","w"))'` } }).status).toBe(2);
    expect(runHook({ tool_name: "Bash", tool_input: { command: "python3 -c 'import json; json.dump(d, open(\"pkg/cfg.json\",\"w\"))'" } }).status).toBe(2);
  });

  it("una ruta RELATIVA se sigue vigilando: su destino depende del cwd del shell", () => {
    // Catch de la review: `cd packages && ... open("../package.json")` escribe
    // DENTRO del repo, y este hook no sabe desde donde se ejecuta el comando.
    // Solo se exime lo que se puede establecer con certeza (ruta absoluta).
    const cmd = { tool_name: "Bash", tool_input: { command: "python3 -c 'import json; json.dump(d, open(\"../../tmp/scratch.json\",\"w\"))'" } };
    expect(runHook(cmd).status).toBe(2);
  });

  it("honra el escape cuando viaja en el propio comando, no solo en el entorno", () => {
    const cmd = "KJ_ALLOW_REWRITE=1 python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'";
    expect(runHook({ tool_name: "Bash", tool_input: { command: cmd } }).status).toBe(0);
  });

  it("el escape del comando solo vale en un comando SIMPLE, y lo dice cuando no", () => {
    // Catch de la review (dos veces): una asignacion delante solo alcanza a SU
    // comando. Ni "VAR=1 && python ..." ni "VAR=1 true && python ..." se la
    // pasan al python.
    for (const cmd of [
      "KJ_ALLOW_REWRITE=1 && python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'",
      "KJ_ALLOW_REWRITE=1 true && python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'",
    ]) {
      const res = runHook({ tool_name: "Bash", tool_input: { command: cmd } });
      expect(res.status, cmd).toBe(2);
      expect(res.stderr).toMatch(/IGNORADO/);
    }
  });

  it("el escape vale con el cuerpo entre comillas dobles: un ; ahi dentro no encadena nada", () => {
    // Catch de la review: filtrar solo las comillas simples daba por compuesto
    // un comando simple y bloqueaba un escape legitimo.
    const cmd = `KJ_ALLOW_REWRITE=1 python3 -c "import json; json.dump(d, open('cfg.json','w'))"`;
    expect(runHook({ tool_name: "Bash", tool_input: { command: cmd } }).status).toBe(0);
  });

  it("un nombre que empieza por dos puntos sigue estando dentro", () => {
    // Catch de la review: "..config.json" no sale del arbol, solo lo parece.
    const inside = path.join(dir, "..config.json");
    const cmd = { tool_name: "Bash", tool_input: { command: `python3 -c 'import json; json.dump(d, open("${inside}","w"))'` } };
    expect(runHook(cmd).status).toBe(2);
  });

  it("un fichero enlazado que apunta al repo se vigila, aunque el enlace viva fuera", () => {
    // Catch de la review: /tmp/link.json -> <repo>/cfg.json. Resolver solo el
    // directorio padre no basta; el fichero mismo puede ser el enlace.
    const target = path.join(dir, "cfg.json");
    fs.writeFileSync(target, "{}");
    const link = path.join(os.tmpdir(), `kj-linkfile-${Date.now()}.json`);
    fs.symlinkSync(target, link);
    try {
      const cmd = { tool_name: "Bash", tool_input: { command: `python3 -c 'import json; json.dump(d, open("${link}","w"))'` } };
      expect(runHook(cmd).status).toBe(2);
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("un comando anidado no hereda el escape", () => {
    // Catch de la review: el python de dentro de $( ) nunca recibe la
    // asignacion, asi que el comando no cuenta como escapado.
    const inner = `python3 -c 'import json; json.dump(d, open("cfg.json","w"))'`;
    const cmd = `KJ_ALLOW_REWRITE=1 echo $(${inner})`;
    expect(runHook({ tool_name: "Bash", tool_input: { command: cmd } }).status).toBe(2);
  });

  it("con expansion del shell no se exime nada: no se sabe a donde apunta", () => {
    // Catch de la review: de "$PWD/cfg.json" se extrae "/cfg.json", que parece
    // absoluto y ajeno sin serlo.
    const cmd = "python3 -c 'import json; json.dump(d, open(\"$PWD/cfg.json\",\"w\"))'";
    expect(runHook({ tool_name: "Bash", tool_input: { command: cmd } }).status).toBe(2);
  });

  it("el escape solo vale donde el shell lo aplica: nombrarlo en un echo no levanta el guard", () => {
    // Catch de la review: buscar el texto en cualquier parte del comando
    // convertia el guard en una contrasena que se dice en voz alta.
    const cmd = "echo KJ_ALLOW_REWRITE=1; python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'";
    expect(runHook({ tool_name: "Bash", tool_input: { command: cmd } }).status).toBe(2);
  });

  it("blocks Bash that reserializes JSON to disk, allows benign bash and the escape", () => {
    const cmd = { tool_name: "Bash", tool_input: { command: "python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'" } };
    const blocked = runHook(cmd);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/rewrit|puntuales|Edit/i);
    expect(runHook({ tool_name: "Bash", tool_input: { command: "python3 -c 'import json; print(json.dumps(d))'" } }).status).toBe(0);
    expect(runHook({ tool_name: "Bash", tool_input: { command: "ls -la" } }).status).toBe(0);
    expect(runHook(cmd, { KJ_ALLOW_REWRITE: "1" }).status).toBe(0);
  });

  it("never crashes the tool flow on garbage input (fail open with exit 0)", () => {
    expect(spawnSync("node", [script], { input: "not-json", encoding: "utf8" }).status).toBe(0);
  });
});

describe("installHarnessHooks settings merge", () => {
  it("is idempotent and preserves the user's existing settings", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { PreToolUse: [{ matcher: "Grep", hooks: [{ type: "command", command: "echo mine" }] }] } }));
    installHarnessHooks({ projectDir: dir });
    installHarnessHooks({ projectDir: dir });
    const cfg = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(cfg.model).toBe("opus");
    const all = JSON.stringify(cfg.hooks.PreToolUse);
    expect(all).toContain("echo mine");
    expect((all.match(/pretooluse\.mjs/g) || []).length).toBe(2); // Write + Bash, once each
  });
});
