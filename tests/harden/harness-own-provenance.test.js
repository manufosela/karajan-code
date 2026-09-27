/**
 * KJC-BUG-0224: el control de integridad no distinguia "kj avanzo" de "alguien
 * lo toco", y con kj enlazado a un arbol de desarrollo disparaba en falso cada
 * vez que cambiaban las plantillas. Decision del usuario: el harness lleva su
 * propia procedencia (lo que `kj harden` escribio), y con ella hay tres casos:
 *   1. coincide con lo que kj escribio, sin sello humano -> kj lo regenera solo
 *   2. sellado por un humano -> desfase, avisa, no se toca (tamper-vs-drift)
 *   3. no coincide con nada -> alguien lo toco -> bloquea
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalHarnessBody, installSentinelHooks, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";

let repo;
const guard = (name) => join(repo, ".karajan", "harness", name);
const record = () => join(repo, ".karajan", "harness", "installed.json");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const noSealInGit = () => { throw new Error("fatal: path does not exist in HEAD"); };

/** Lo que dejaria una version anterior de kj: su cuerpo y su registro. */
function installedByOlderKj(name, oldBody) {
  writeFileSync(guard(name), oldBody);
  const rec = JSON.parse(readFileSync(record(), "utf8"));
  rec.files[name] = sha(oldBody);
  writeFileSync(record(), JSON.stringify(rec));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-own-prov-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  installSentinelHooks({ projectDir: repo, logger: { info: () => {}, warn: () => {} } });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("procedencia propia del harness", () => {
  it("kj harden registra el sha256 de cada guardia que escribe", () => {
    const rec = JSON.parse(readFileSync(record(), "utf8"));
    expect(rec.files["stop.mjs"]).toBe(sha(canonicalHarnessBody("stop.mjs")));
  });

  it("caso 1: lo que kj escribio, con kj por delante, se regenera solo y se dice", () => {
    installedByOlderKj("stop.mjs", "// guardia de una version anterior de kj\n");
    const res = verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit });
    expect(res).toMatchObject({ ok: true, mismatched: [], regenerated: ["stop.mjs"] });
    expect(readFileSync(guard("stop.mjs"), "utf8")).toBe(canonicalHarnessBody("stop.mjs"));
    // y queda registrado lo nuevo: la siguiente verificacion esta limpia
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit })).toMatchObject({ ok: true, mismatched: [] });
  });

  it("caso 2: si un humano lo sello, manda el sello y no se regenera", () => {
    const old = "// version sellada\n";
    installedByOlderKj("stop.mjs", old);
    const gitShowFn = () => JSON.stringify({ files: [{ file: ".karajan/harness/stop.mjs", sha256: sha(old) }] });
    const res = verifySentinelScripts({ projectDir: repo, gitShowFn });
    expect(res).toMatchObject({ ok: true, drift: ["stop.mjs"] });
    expect(res.regenerated ?? []).toEqual([]);
    expect(readFileSync(guard("stop.mjs"), "utf8")).toBe(old);
  });

  it("caso 3: contenido que kj no escribio bloquea y no se toca", () => {
    const edited = "// alguien ha estado aqui\n";
    writeFileSync(guard("stop.mjs"), edited);
    const res = verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit });
    expect(res).toMatchObject({ ok: false, mismatched: ["stop.mjs"] });
    expect(readFileSync(guard("stop.mjs"), "utf8")).toBe(edited);
  });

  it("forjar el registro solo consigue que se restaure el cuerpo canonico", () => {
    // Una sesion que edita el guardia Y su registro no gana nada: el caso 1
    // escribe lo que trae el kj instalado, que es exactamente restaurarlo.
    installedByOlderKj("stop.mjs", "// guardia manipulado con registro forjado\n");
    verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit });
    expect(readFileSync(guard("stop.mjs"), "utf8")).toBe(canonicalHarnessBody("stop.mjs"));
  });

  it("sin registro (instalacion anterior a esto) se comporta como antes: bloquea", () => {
    rmSync(record());
    writeFileSync(guard("stop.mjs"), "// cualquier cosa\n");
    expect(verifySentinelScripts({ projectDir: repo, gitShowFn: noSealInGit }).ok).toBe(false);
  });
});
