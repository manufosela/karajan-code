// KJC-TSK-0886: en campo, el gate paso de 48 a 4 fuentes y volvio a 48 en tres
// minutos porque el arbol enlazado del que salia kj cambio de rama entre el
// review y el commit. La version sola no lo delata: en un arbol enlazado el
// mismo package.json corresponde a estados del disco distintos. Cada veredicto
// dice que kj lo emitio, y el check dice si lo comprueba otro.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kjStamp, stampDiffers } from "../../src/review/kj-provenance.js";
import { checkVerdict, diffHash, saveVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-stamp-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kjStamp", () => {
  it("un arbol enlazado lleva rama y commit de su working tree", () => {
    const git = (args) => (args.includes("--abbrev-ref") ? "feat/x\n" : "c0ffeec0ffeec0ffee\n");
    const s = kjStamp({ provenance: { version: "4.35.1", linked: true, root: "/w/kj" }, git });
    expect(s).toEqual({ version: "4.35.1", linked: true, branch: "feat/x", commit: "c0ffeec0ffeec0ffee" });
  });

  it("un kj instalado no pregunta a git: su version basta", () => {
    const git = () => { throw new Error("no deberia llamarse"); };
    expect(kjStamp({ provenance: { version: "4.35.1", linked: false, root: "/n/karajan-code" }, git })).toEqual({ version: "4.35.1", linked: false });
  });

  it("sin git legible no revienta: el sello adorna, no decide", () => {
    const git = () => { throw new Error("not a git repository"); };
    expect(kjStamp({ provenance: { version: "4.35.1", linked: true, root: "/w/kj" }, git })).toEqual({ version: "4.35.1", linked: true });
  });
});

describe("el veredicto registra que kj lo emitio", () => {
  it("saveVerdict guarda el sello del kj actual", async () => {
    const rec = await saveVerdict(dir, "diff --git a/x b/x\n", { verdict: "approved", reviewer: "codex" });
    expect(rec.kj).toMatchObject({ version: expect.any(String), linked: expect.any(Boolean) });
  });

  it("quien llama no puede dictar el sello: siempre es el del kj local", async () => {
    const rec = await saveVerdict(dir, "d\n", { verdict: "approved", reviewer: "codex", kj: { version: "forjado" } });
    expect(rec.kj.version).not.toBe("forjado");
  });

  it("comprobado por otro kj no bloquea, pero lo dice en una linea", async () => {
    // Un veredicto que dejo otro kj en disco (el sello no se puede inyectar).
    const other = { version: "4.30.0", linked: true, branch: "feat/old", commit: "aaaaaaaaaaaa" };
    const file = join(dir, ".karajan", "reviews", `${diffHash("d\n")}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ verdict: "approved", reviewer: "codex", diffHash: diffHash("d\n"), kj: other }));
    const res = await checkVerdict(dir, "d\n");
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/verdict from kj 4\.30\.0 \(feat\/old@aaaaaaa\), checked by kj /);
  });

  it("mismo kj, sin nota", () => {
    const a = { version: "4.35.1", linked: true, branch: "main", commit: "abc" };
    expect(stampDiffers(a, { ...a })).toBe(false);
    expect(stampDiffers(a, { ...a, commit: "def" })).toBe(true);
    expect(stampDiffers(undefined, a)).toBe(false); // veredictos anteriores a esto: nada que comparar
  });
});
