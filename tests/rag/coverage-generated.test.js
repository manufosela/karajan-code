// KJC-BUG-0221: `kj harden` instala commitlint.config.js y eslint.config.js, y
// despues `kj check` denuncia esos mismos ficheros como drift del indice. Un
// bucle cerrado: la herramienta crea el fichero y se queja de que no lo ha
// indexado, asi que `kj check` no sale limpio nunca por algo que el equipo no
// ha escrito. El criterio ya existe en el presupuesto de LOC: lo generado no
// cuenta, porque nadie lo escribio.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ragIndexCoverage, isGeneratedByHarden } from "../../src/rag/coverage.js";
import { FIXTURE_SOURCES, makeCoverageRepo } from "./coverage-fixture.js";

let f;
beforeEach(() => { f = makeCoverageRepo(); });
afterEach(() => f.cleanup());

describe("isGeneratedByHarden", () => {
  it("reconoce los configs que instala kj harden, en la raiz y en un subproyecto", () => {
    for (const p of ["commitlint.config.js", "eslint.config.js", "functions/commitlint.config.js", "packages/api/eslint.config.js"]) {
      expect(isGeneratedByHarden(p), p).toBe(true);
    }
  });

  it("no se lleva por delante codigo del equipo con un nombre parecido", () => {
    for (const p of ["src/eslint.config.helper.js", "src/commitlint.js", "tools/my-eslint.config.wrapper.js"]) {
      expect(isGeneratedByHarden(p), p).toBe(false);
    }
  });
});

describe("ragIndexCoverage — lo que genera kj no es deuda del equipo", () => {
  it("un config instalado por harden no cuenta como fuente sin indexar", async () => {
    fs.writeFileSync(path.join(f.repo, "eslint.config.js"), "export default [];\n");
    f.git("add", "-A");
    f.git("commit", "-q", "-m", "harden configs");
    for (const [i, rel] of FIXTURE_SOURCES.entries()) f.index(rel, i);

    const c = await ragIndexCoverage(f.repo, { db: f.db });
    expect(c.missing).toEqual([]);
    expect(c.generated).toContain("eslint.config.js");
  });

  it("una fuente del equipo sin indexar SIGUE contando: la exencion no tapa nada mas", async () => {
    f.index("src/a.js", 0);
    const c = await ragIndexCoverage(f.repo, { db: f.db });
    expect(c.missing).toContain("scripts/b.js");
  });
});
