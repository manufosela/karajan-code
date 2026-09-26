/**
 * KJC-BUG-0205: el presupuesto de PR estaba implementado TRES veces y las tres
 * daban respuestas distintas. En una PR de solo documentacion el gate local
 * avisaba de 234 lineas y el de CI contaba 104; y la plantilla que kj genera
 * para otros proyectos excluia TODOS los .md, incluidos los que instruyen al
 * agente.
 *
 * Las dos reglas, que no son la misma:
 *   generado     = no cuenta, nadie lo escribio
 *   documentacion = no cuenta, racionarla es como se acaba entregando
 *                   funcionalidad que nadie puede descubrir
 * Y la excepcion a la excepcion: los ficheros de reglas para la IA SI cuentan,
 * porque entran en su contexto en cada ejecucion.
 */
import { describe, expect, it } from "vitest";

import { budgetedAdded, countsTowardBudget } from "../../src/review/loc-budget.js";

describe("countsTowardBudget", () => {
  it.each([
    "src/app.js",
    "tests/app.test.js",
    "packages/core/src/x.js",
    "scripts/verify-pack.mjs",
    ".github/workflows/kj-quality.yml",
    "apps/landing/public/index.html",
  ])("codigo y config cuentan: %s", (f) => expect(countsTowardBudget(f)).toBe(true));

  it.each([
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    "templates/coder-rules.md",
    "src/templates/review.md",
  ])("los ficheros de reglas para la IA cuentan, a proposito: %s", (f) => expect(countsTowardBudget(f)).toBe(true));

  it.each([
    "apps/landing/docs/src/content/docs/reference/configuration.mdx",
    "apps/landing/docs/src/content/docs/es/handbook/commands/code.mdx",
    "docs/troubleshooting.md",
    "CHANGELOG.md",
    "README.md",
    "README.es.md",
    "CONTRIBUTING.md",
    "MIGRATION-v4.md",
  ])("la documentacion humana no cuenta: %s", (f) => expect(countsTowardBudget(f)).toBe(false));

  it.each([
    "apps/landing/public/docs/index.html",
    "apps/landing/docs/dist/index.html",
    "coverage/lcov-report/index.html",
    "node_modules/x/index.js",
    "package-lock.json",
    "pnpm-lock.yaml",
    "npm-shrinkwrap.json",
    "Cargo.lock",
    "poetry.lock",
    "assets/app.min.js",
    "assets/app.js.map",
    "tests/__snapshots__/a.snap",
    "tests/_diet/fixture.js",
  ])("lo generado no cuenta: %s", (f) => expect(countsTowardBudget(f)).toBe(false));

  it("nada no cuenta", () => {
    expect(countsTowardBudget("")).toBe(false);
    expect(countsTowardBudget(null)).toBe(false);
  });
});

describe("budgetedAdded", () => {
  const numstat = [
    "40\t2\tsrc/app.js",
    "60\t0\ttests/app.test.js",
    "36\t0\tapps/landing/docs/src/content/docs/reference/configuration.mdx",
    "120\t3\tapps/landing/public/docs/index.html",
    "10\t0\tCLAUDE.md",
    "-\t-\tlogo.png",
  ].join("\n");

  it("suma lo que cuenta y aparta lo que no, diciendo cuanto", () => {
    expect(budgetedAdded(numstat)).toEqual({ added: 110, exempt: 156, testAdded: 60 });
  });

  it("separa los tests que acompanan al cambio: partir jamas separa codigo de sus tests", () => {
    expect(budgetedAdded("30\t0\tsrc/a.js\n70\t0\ttests/a.test.js").testAdded).toBe(70);
  });

  it("un numstat vacio o con binarios no revienta", () => {
    expect(budgetedAdded("")).toEqual({ added: 0, exempt: 0, testAdded: 0 });
    expect(budgetedAdded(null)).toEqual({ added: 0, exempt: 0, testAdded: 0 });
    expect(budgetedAdded("-\t-\ta.png")).toEqual({ added: 0, exempt: 0, testAdded: 0 });
  });

  it("el caso que lo destapo: una PR de solo documentacion no consume presupuesto", () => {
    const docsOnly = [
      "36\t0\tapps/landing/docs/src/content/docs/reference/configuration.mdx",
      "36\t0\tapps/landing/docs/src/content/docs/es/reference/configuration.mdx",
      "13\t0\tapps/landing/docs/src/content/docs/handbook/commands/code.mdx",
      "150\t40\tapps/landing/public/docs/index.html",
    ].join("\n");
    expect(budgetedAdded(docsOnly).added).toBe(0);
  });
});
