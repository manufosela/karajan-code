/**
 * KJC-BUG-0215 (issue #1733): la regla acusaba por el NOMBRE del identificador
 * y bloqueaba sin salida. Un prefijo de cache de un proyecto Laravel,
 * `EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE = 'experiments-handoff-tokens'`, tumbo
 * la ejecucion entera con severidad critica.
 *
 * El arreglo es un cauce declarado, no una heuristica: la review tumbo tres
 * intentos de deducir del valor si era un secreto, y con razon, porque
 * `const dbPassword = 'db-password'` tambien parece inocente.
 */
import { describe, expect, it } from "vitest";

import { declaredNonSecret, scanDiff } from "../../src/guards/output-guard.js";

const FILE = "app/Cache.php";
const CACHE_LINE = "public const EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE = 'experiments-handoff-tokens';";

const diffWith = (line, file = FILE) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,2 @@\n+${line}\n`;

const withDeclared = (...entries) => ({ guards: { output: { non_secret_assignments: entries } } });

describe("declaredNonSecret", () => {
  it("reconoce la declaracion por nombre y por fichero:nombre", () => {
    const byName = withDeclared("EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE").guards;
    const byPath = withDeclared(`${FILE}:EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE`).guards;
    expect(declaredNonSecret(byName, FILE, CACHE_LINE)).toBe(true);
    expect(declaredNonSecret(byPath, FILE, CACHE_LINE)).toBe(true);
  });

  it("la declaracion con fichero no vale para otro fichero", () => {
    const scoped = withDeclared(`${FILE}:EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE`).guards;
    expect(declaredNonSecret(scoped, "app/Other.php", CACHE_LINE)).toBe(false);
  });

  it("sin declaraciones, o con otro nombre, no exime", () => {
    expect(declaredNonSecret({}, FILE, CACHE_LINE)).toBe(false);
    expect(declaredNonSecret(withDeclared("OTHER_NAME").guards, FILE, CACHE_LINE)).toBe(false);
    expect(declaredNonSecret(withDeclared(42).guards, FILE, CACHE_LINE)).toBe(false);
  });
});

describe("scanDiff — el caso del reporte", () => {
  it("sin declarar sigue bloqueando, pero ya dice como declararlo", () => {
    const res = scanDiff(diffWith(CACHE_LINE));
    expect(res.pass).toBe(false);
    expect(res.violations[0].severity).toBe("critical");
    expect(res.violations[0].message).toMatch(/non_secret_assignments/);
  });

  it("declarado informa y NO bloquea", () => {
    const res = scanDiff(diffWith(CACHE_LINE), withDeclared(`${FILE}:EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE`));
    expect(res.pass).toBe(true);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]).toMatchObject({ id: "hardcoded-key-assignment", severity: "warning" });
    expect(res.violations[0].message).toMatch(/Declared as non-secret/);
  });

  it("declarar un nombre no ablanda las reglas que miran la FORMA del valor", () => {
    const aws = `AKIA${"IOSFODNN7EXAMPLE"}`;
    const config = withDeclared("awsKey");
    const res = scanDiff(diffWith(`const awsKey = '${aws}';`), config);
    expect(res.pass).toBe(false);
    expect(res.violations.some(v => v.id === "aws-key" && v.severity === "critical")).toBe(true);
  });

  it("una credencial de verdad bajo un nombre no declarado bloquea", () => {
    for (const line of ["const password = 'correct horse battery staple';", "const dbPassword = 'db-password';"]) {
      expect(scanDiff(diffWith(line)).pass, line).toBe(false);
    }
  });

  it("el remedio deja de ser consejo de JavaScript en un fichero que no lo es", () => {
    const res = scanDiff(diffWith(`const apiToken = '${"AbC123XyZ789QwErTy456"}';`));
    expect(res.violations[0].message).not.toMatch(/process\.env/);
    expect(res.violations[0].message).toMatch(/environment or a secrets manager/);
  });
});
