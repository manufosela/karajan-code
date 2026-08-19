// MIG-A parte 2 (KJC-TSK-0751) — dual-publish: el MISMO contenido sale como
// karajan-code y como @karajan-family/code. El swap del name es EN SITIO con
// restauración garantizada (try/finally): un crash a mitad no puede dejar el
// manifest renombrado. En MIG-A solo --pack-only; --publish llega con la
// release v4.19.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withScopedName, SCOPED_NAME } from "../../scripts/dual-publish.mjs";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-dual-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "karajan-code", version: "9.9.9", bin: { kj: "bin/kj.js" } }, null, 2) + "\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const readPkg = () => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));

describe("withScopedName", () => {
  it("dentro del bloque el manifest es @karajan-family/code con publishConfig public; fuera, restaurado BYTE a byte", async () => {
    const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    await withScopedName(dir, async () => {
      const pkg = readPkg();
      expect(pkg.name).toBe(SCOPED_NAME);
      expect(pkg.version).toBe("9.9.9");
      expect(pkg.publishConfig).toEqual({ access: "public" });
      expect(pkg.bin).toEqual({ kj: "bin/kj.js" }); // el binario no cambia
    });
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(before);
  });

  it("un publishConfig preexistente se MERGEA, no se pisa (catch de codex)", async () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "karajan-code", version: "1.0.0", publishConfig: { tag: "next" } }) + "\n");
    await withScopedName(dir, async () => {
      expect(readPkg().publishConfig).toEqual({ tag: "next", access: "public" });
    });
  });

  it("si el bloque revienta, el manifest queda restaurado igualmente y el error sube", async () => {
    const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    await expect(withScopedName(dir, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(before);
  });

  it("se niega a hacer swap sobre un manifest que NO es el legacy esperado — jamás renombra a ciegas", async () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "otra-cosa", version: "1.0.0" }) + "\n");
    await expect(withScopedName(dir, async () => {})).rejects.toThrow(/karajan-code/);
  });
});
