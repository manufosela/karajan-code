/**
 * KJC-BUG-0193: `kj harden` (sin --commit) reescribia los guardias SELLADOS, y
 * ese es el comando con el que una sesion se desbloquea cuando ha tocado las
 * plantillas. Resultado: el propio desbloqueo destruia el sello que hacia
 * innecesario volver a usarlo, y los guardias que corren quedaban sin sellar.
 * Seis hardens en dos horas el 2026-09-26, ninguno para endurecer nada.
 *
 * Lo sellado solo lo avanza un humano (`kj harden --commit`, ADR 0009). Lo que
 * nadie sello se reescribe como siempre, porque restaurar un guardia manipulado
 * sigue siendo lo correcto.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let repo;
const quiet = { info: () => {}, warn: () => {} };
const guard = (name) => join(repo, ".karajan", "harness", name);
const read = (name) => readFileSync(guard(name), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const sealedInGit = (entries) => () => JSON.stringify({ kj_version: "4.33.0", files: entries });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seal-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  installSentinelHooks({ projectDir: repo, logger: quiet });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("installSentinelHooks respeta el sello (KJC-BUG-0193)", () => {
  it("no reescribe un guardia cuyo contenido instalado es el que un humano sello, y lo dice", () => {
    // El guardia que corre es EXACTAMENTE lo sellado; las plantillas han
    // avanzado (lo simulamos sellando el contenido de ahora y luego pidiendo
    // una reinstalacion que escribiria otro cuerpo).
    const installed = read("stop.mjs");
    writeFileSync(guard("stop.mjs"), `${installed}// las plantillas iban por delante\n`);
    const drifted = read("stop.mjs");
    const res = installSentinelHooks({
      projectDir: repo,
      logger: quiet,
      gitShowFn: sealedInGit([{ file: ".karajan/harness/stop.mjs", sha256: sha(drifted) }]),
    });
    expect(read("stop.mjs")).toBe(drifted);
    expect(res.deferred).toEqual(["stop.mjs"]);
  });

  it("reescribe un guardia que nadie sello: restaurar lo manipulado sigue siendo lo correcto", () => {
    const pristine = read("stop.mjs");
    writeFileSync(guard("stop.mjs"), "// alguien ha estado aqui\n");
    const res = installSentinelHooks({
      projectDir: repo,
      logger: quiet,
      gitShowFn: sealedInGit([{ file: ".karajan/harness/posttooluse.mjs", sha256: "0".repeat(64) }]),
    });
    expect(read("stop.mjs")).toBe(pristine);
    expect(res.deferred ?? []).toEqual([]);
  });

  it("sin procedencia ninguna escribe todo, que es la instalacion desde cero", () => {
    writeFileSync(guard("stop.mjs"), "// contenido viejo\n");
    const res = installSentinelHooks({
      projectDir: repo,
      logger: quiet,
      gitShowFn: () => { throw new Error("fatal: path does not exist in HEAD"); },
    });
    expect(read("stop.mjs")).not.toBe("// contenido viejo\n");
    expect(res.deferred ?? []).toEqual([]);
  });

  it("un sello de OTRO fichero no cubre este: el hash va ligado a su ruta", () => {
    const mine = `${read("stop.mjs")}// desfase\n`;
    writeFileSync(guard("stop.mjs"), mine);
    const res = installSentinelHooks({
      projectDir: repo,
      logger: quiet,
      // El hash correcto, pero sellado para otra ruta.
      gitShowFn: sealedInGit([{ file: ".karajan/harness/posttooluse.mjs", sha256: sha(mine) }]),
    });
    expect(read("stop.mjs")).not.toBe(mine);
    expect(res.deferred ?? []).toEqual([]);
  });

  it("avanzar los guardias es un acto humano: --commit los escribe aunque esten sellados", () => {
    const installed = read("stop.mjs");
    const drifted = `${installed}// desfase\n`;
    writeFileSync(guard("stop.mjs"), drifted);
    const res = installSentinelHooks({
      projectDir: repo,
      logger: quiet,
      human: true,
      gitShowFn: sealedInGit([{ file: ".karajan/harness/stop.mjs", sha256: sha(drifted) }]),
    });
    expect(read("stop.mjs")).toBe(installed);
    expect(res.deferred ?? []).toEqual([]);
  });
});
