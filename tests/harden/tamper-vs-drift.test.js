/**
 * KJC-BUG-0197: la deteccion de manipulacion comparaba contra el ARBOL DE
 * TRABAJO. Para cualquier usuario eso es inocuo (las plantillas viven en
 * node_modules y no pueden estar sucias), pero con kj npm-linkado las
 * plantillas de referencia son las que se estan editando, asi que tocar una se
 * leia como manipular los guardias y dejaba la sesion sin herramientas hasta
 * que un humano reinstalaba. La pregunta del usuario lo resumio: si hay que
 * ejecutar harden todo el rato, algo no esta bien definido.
 *
 * La distincion, contra la referencia que el sello ya cubre (ADR 0009):
 *   manipulacion = el guardia instalado tiene contenido que NADIE sello
 *   desfase      = el guardia esta sellado y las plantillas van por delante
 *
 * Un primer intento daba por desfase cualquier discrepancia cuando las
 * plantillas estaban sucias en git. La review lo rechazo con razon: bastaba
 * ensuciar una plantilla para disfrazar un guardia manipulado. El sello cierra
 * eso, porque editar un guardia produce contenido que ningun sello cubre.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";

let repo;
const guard = (name) => join(repo, ".karajan", "harness", name);
const sha = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Simula lo que `git show HEAD:.karajan/supervisor-provenance.json` devolveria,
 * que es de donde se lee el sello: NO del arbol de trabajo, que una sesion
 * puede forjar (catch de la review).
 */
const sealedInGit = (entries) => () => JSON.stringify({ kj_version: "4.33.0", files: entries });
const noSealInGit = () => { throw new Error("fatal: path does not exist in HEAD"); };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-tamper-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  installSentinelHooks({ projectDir: repo, logger: { info: () => {}, warn: () => {} } });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("verifySentinelScripts", () => {
  it("recien instalado, los guardias coinciden", () => {
    expect(verifySentinelScripts({ projectDir: repo })).toMatchObject({ ok: true, mismatched: [] });
  });

  it("un guardia con contenido que nadie sello es MANIPULACION y bloquea", () => {
    writeFileSync(guard("stop.mjs"), "// alguien ha estado aqui\n");
    const res = verifySentinelScripts({ projectDir: repo });
    expect(res.ok).toBe(false);
    expect(res.mismatched).toEqual(["stop.mjs"]);
  });

  it("con procedencia sellada de OTRO contenido tampoco pasa: el sello es del contenido", () => {
    writeFileSync(guard("stop.mjs"), "// alguien ha estado aqui\n");
    const gitShowFn = sealedInGit([{ file: ".karajan/harness/stop.mjs", sha256: sha("otra cosa") }]);
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn }).ok).toBe(false);
  });

  it("un sello de OTRO fichero no vale para este: el hash va atado a su ruta", () => {
    const body = "// contenido que alguien colo en stop.mjs\n";
    writeFileSync(guard("stop.mjs"), body);
    // El mismo hash, pero sellado para el pre-commit. No debe valer.
    const gitShowFn = sealedInGit([{ file: ".karajan/hooks/pre-commit", sha256: sha(body) }]);
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn }).ok).toBe(false);
  });

  it("una procedencia forjada en el ARBOL no vale: el sello se lee de git", () => {
    const body = "// guardia manipulado\n";
    writeFileSync(guard("stop.mjs"), body);
    // Esto es lo que haria una sesion maliciosa: escribir el hash en el fichero.
    writeFileSync(
      join(repo, ".karajan", "supervisor-provenance.json"),
      JSON.stringify({ files: [{ file: ".karajan/harness/stop.mjs", sha256: sha(body) }] }),
    );
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit }).ok).toBe(false);
  });

  it("un guardia SELLADO con plantillas que avanzaron es DESFASE, no manipulacion", () => {
    const sealedBody = "// version sellada, mas vieja que las plantillas\n";
    writeFileSync(guard("stop.mjs"), sealedBody);
    const gitShowFn = sealedInGit([{ file: ".karajan/harness/stop.mjs", sha256: sha(sealedBody) }]);

    const res = verifySentinelScripts({ projectDir: repo, gitShowFn });
    expect(res.ok).toBe(true);
    expect(res.mismatched).toEqual([]);      // lo que leen los hooks: nada que bloquear
    expect(res.drift).toEqual(["stop.mjs"]); // pero el hecho no se esconde
    expect(res.reason).toContain("no es manipulación");
  });

  it("sellado y manipulado a la vez: manda la manipulacion", () => {
    const sealedBody = "// version sellada\n";
    writeFileSync(guard("stop.mjs"), sealedBody);
    writeFileSync(guard("posttooluse.mjs"), "// esto no lo sello nadie\n");
    const gitShowFn = sealedInGit([{ file: ".karajan/harness/stop.mjs", sha256: sha(sealedBody) }]);

    const res = verifySentinelScripts({ projectDir: repo, gitShowFn });
    expect(res.ok).toBe(false);
    expect(res.mismatched).toEqual(["posttooluse.mjs"]);
    expect(res.drift).toEqual(["stop.mjs"]);
  });

  it("un guardia que falta cuenta como manipulacion: no hay contenido que sellar", () => {
    rmSync(guard("stop.mjs"));
    expect(verifySentinelScripts({ projectDir: repo }).mismatched).toEqual(["stop.mjs"]);
  });

  it("sin procedencia sellada (nunca se hizo harden --commit) falla cerrado", () => {
    writeFileSync(guard("stop.mjs"), "// cualquier cosa\n");
    expect(verifySentinelScripts({ projectDir: repo })).toMatchObject({ ok: false, mismatched: ["stop.mjs"] });
  });

  it("una procedencia ilegible no concede nada", () => {
    writeFileSync(guard("stop.mjs"), "// cualquier cosa\n");
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn: () => "{ esto no es json" }).ok).toBe(false);
  });
});
