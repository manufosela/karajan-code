/**
 * KJC-BUG-0203: el gate de privacidad lee el diff POR FICHERO, y en salida de
 * build calla las heuristicas genericas pero NUNCA un dato del denylist: el
 * incidente que creo este escaner fue justo eso, datos personales dentro de un
 * artefacto publicado.
 */
import { describe, expect, it } from "vitest";

import { isGeneratedPath, splitAddedByFile } from "../../src/privacy/diff-scope.js";

const DIFF = [
  "diff --git a/src/app.js b/src/app.js",
  "index a1b2c3d..e4f5a6b 100644",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = 2;",
  "-const gone = 3;",
  "+const c = 4;",
  "diff --git a/apps/landing/public/docs/index.html b/apps/landing/public/docs/index.html",
  "--- a/apps/landing/public/docs/index.html",
  "+++ b/apps/landing/public/docs/index.html",
  "@@ -1 +1 @@",
  "+<span class=astro-4yphtoen>",
].join("\n");

describe("splitAddedByFile", () => {
  it("agrupa las lineas anadidas por fichero, sin cabeceras ni borrados", () => {
    const files = splitAddedByFile(DIFF);
    expect(files.map((f) => f.file)).toEqual(["src/app.js", "apps/landing/public/docs/index.html"]);
    expect(files[0].added).toBe("const b = 2;\nconst c = 4;");
    expect(files[0].added).not.toContain("gone");
    expect(files[0].added).not.toContain("+++");
  });

  it("un fichero solo con borrados no aparece: lo borrado no se publica", () => {
    const onlyDeletes = ["diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js", "-const gone = 1;"].join("\n");
    expect(splitAddedByFile(onlyDeletes)).toEqual([]);
  });

  it("un diff vacio o basura no revienta", () => {
    expect(splitAddedByFile("")).toEqual([]);
    expect(splitAddedByFile(null)).toEqual([]);
    expect(splitAddedByFile("+suelto sin cabecera")).toEqual([]);
  });

  it("conserva una linea anadida en blanco", () => {
    const withBlank = ["diff --git a/x.js b/x.js", "+++ b/x.js", "+a", "+", "+b"].join("\n");
    expect(splitAddedByFile(withBlank)[0].added).toBe("a\n\nb");
  });
});

describe("isGeneratedPath", () => {
  it.each([
    "dist/index.js",
    "apps/landing/public/docs/index.html",
    "coverage/lcov-report/index.html",
    "node_modules/x/index.js",
    "apps/landing/docs/.astro/data-store.json",
    "assets/app.min.js",
    "assets/app.js.map",
  ])("es salida de build: %s", (p) => expect(isGeneratedPath(p)).toBe(true));

  it.each([
    "src/app.js",
    "tests/app.test.js",
    "apps/landing/public/index.html",
    "docs/guide.md",
    "distribution/notes.md",
    "src/build-helper.js",
  ])("lo escribe una persona: %s", (p) => expect(isGeneratedPath(p)).toBe(false));

  it("nada no es nada", () => {
    expect(isGeneratedPath("")).toBe(false);
    expect(isGeneratedPath(null)).toBe(false);
  });
});
