// KJC-BUG-0223: dos modulos decidian sobre el MISMO harness y no miraban el
// mismo directorio. `readRagLedger` usaba process.cwd() y `verifySentinelScripts`
// el toplevel de git, asi que ejecutar `kj review --staged` o commitear desde un
// subdirectorio (functions/, packages/x/) bloqueaba siempre. Y `kj harden` desde
// ese mismo sitio sembraba un `.karajan/harness` nuevo ahi, con lo que el
// comando siguiente pasaba: el ritual quedaba "arreglado" y el arbol lleno de
// arneses huerfanos.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readRagLedger } from "../../src/review/rag-ledger.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { installHarnessHooks } from "../../src/harden/harness-hooks.js";

let repo, sub;
const quiet = { info() {}, warn() {} };

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-root-"));
  sub = path.join(repo, "functions");
  fs.mkdirSync(sub, { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  installSentinelHooks({ projectDir: repo, logger: quiet });
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("una sola respuesta a cual es la raiz del proyecto", () => {
  it("desde un subdirectorio se ve el MISMO harness que desde la raiz", () => {
    const fromRoot = readRagLedger(repo);
    const fromSub = readRagLedger(sub);
    expect(fromRoot.harness).toBe(true);
    expect(fromSub.harness).toBe(true);
    expect(fromSub.verified).toBe(fromRoot.verified);
  });

  it("el veredicto sobre el harness no cambia por el directorio desde el que se mire", () => {
    // Un guard manipulado se ve manipulado desde los dos sitios, no solo desde uno.
    fs.writeFileSync(path.join(repo, ".karajan", "harness", "stop.mjs"), "// tocado a mano\n");
    expect(readRagLedger(repo).verified).toBe(false);
    expect(readRagLedger(sub).verified).toBe(false);
    expect(readRagLedger(sub).mismatched).toContain("stop.mjs");
  });

  it("fuera de un repo git, la raiz es el directorio dado y no se inventa nada", () => {
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), "kj-noroot-"));
    try {
      expect(readRagLedger(loose).harness).toBe(false);
    } finally {
      fs.rmSync(loose, { recursive: true, force: true });
    }
  });
});

describe("harden no siembra arneses huerfanos", () => {
  it("instalar desde un subdirectorio escribe en la raiz del repo, no en el subdirectorio", () => {
    installSentinelHooks({ projectDir: sub, logger: quiet });
    expect(fs.existsSync(path.join(sub, ".karajan", "harness"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".karajan", "harness", "stop.mjs"))).toBe(true);
  });

  it("el gate de tool tampoco: los dos instaladores responden lo mismo", () => {
    installHarnessHooks({ projectDir: sub, logger: quiet });
    expect(fs.existsSync(path.join(sub, ".karajan", "harness"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".karajan", "harness", "pretooluse.mjs"))).toBe(true);
  });

  it("lo dice cuando lo redirige, en vez de instalar en otro sitio en silencio", () => {
    const said = [];
    installSentinelHooks({ projectDir: sub, logger: { info: (m) => said.push(m), warn() {} } });
    expect(said.join(" ")).toMatch(/se instala en su raíz/);
  });
});
