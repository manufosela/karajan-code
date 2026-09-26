// KJC-BUG-0216 (issue #1807): el gate rag-first exigia una respuesta del RAG
// sobre CUALQUIER fichero tocado, y para un .astro (o .php, o cualquier
// lenguaje sin adapter) eso es imposible: el indexador nunca lo toma. La unica
// salida era KJ_ALLOW_NO_RAG puesta por costumbre, que borra la diferencia
// entre "no pude consultar" y "no quise consultar". Antes de arreglar el gate
// hace falta el hecho comprobable: por que el RAG no puede responder.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { fileIndexState } from "../../src/rag/coverage.js";
import { makeCoverageRepo } from "./coverage-fixture.js";

let f;
beforeEach(() => { f = makeCoverageRepo(); });
afterEach(() => f.cleanup());

describe("fileIndexState", () => {
  it("con el indice vacio no culpa al fichero", () => {
    expect(fileIndexState(f.repo, "src/a.js", { db: f.db })).toMatchObject({ state: "index-empty", canAnswer: false });
  });

  it("un fichero con chunks es indexed, y ahi el gate SI puede exigir la consulta", () => {
    f.index("src/a.js", 0);
    expect(fileIndexState(f.repo, "src/a.js", { db: f.db })).toMatchObject({ state: "indexed", canAnswer: true });
  });

  it("acepta el path absoluto igual que el relativo", () => {
    f.index("src/a.js", 0);
    const abs = `${f.repo}/src/a.js`;
    expect(fileIndexState(f.repo, abs, { db: f.db })).toMatchObject({ state: "indexed", rel: "src/a.js" });
  });

  it("el caso del reporte: ningun adapter cubre .astro, asi que NO es indexable", () => {
    f.index("src/a.js", 0);
    const res = fileIndexState(f.repo, "src/Page.astro", { db: f.db });
    expect(res).toMatchObject({ state: "not-indexable", canAnswer: false });
    expect(res.reason).toMatch(/\.astro/);
  });

  it("un segmento que el indexador siempre salta tambien es not-indexable", () => {
    f.index("src/a.js", 0);
    expect(fileIndexState(f.repo, "node_modules/n/d.js", { db: f.db })).toMatchObject({ state: "not-indexable" });
    expect(fileIndexState(f.repo, "dist/bundle.js", { db: f.db })).toMatchObject({ state: "not-indexable" });
  });

  it("indexable y ausente es stale: el indice va por detras, y se dice como ponerlo al dia", () => {
    f.index("src/a.js", 0);
    const res = fileIndexState(f.repo, "scripts/b.js", { db: f.db });
    expect(res).toMatchObject({ state: "stale", canAnswer: false });
    expect(res.reason).toMatch(/kj rag index/);
  });
});
