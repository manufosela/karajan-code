// GOV-A (KJC-TSK-0745) — el kernel funciona SIN karajan-code: los defaults
// inexcepcionables los inyecta el consumidor (aquí, un dominio inventado de
// expedientes), no hay tools de harness ni rutas .karajan en el motor.

import { describe, it, expect } from "vitest";
import { parsePolicy, evalWrite, evalShell, checkArtifacts } from "../../packages/governance/src/engine.js";

const LEDGER_DEFAULTS = [
  { id: "defaults.ledger.sealed", pattern: /sealed\//, message: "toca expedientes sellados — solo el registrador los modifica" },
];

describe("kernel sin adaptador de code", () => {
  it("los defaults inyectados deniegan como inexcepcionables con el rule_id del consumidor", () => {
    const { policy, errors } = parsePolicy(null, { defaults: LEDGER_DEFAULTS });
    expect(errors).toEqual([]);
    const v = evalWrite(policy, "clerk", "sealed/case-42.json");
    expect(v).toMatchObject({ decision: "deny", rule_id: "defaults.ledger.sealed", enforcement: "deny", class: "security" });
    expect(evalShell(policy, "clerk", "rm sealed/case-42.json").decision).toBe("deny");
  });

  it("sin defaults ni policy, todo permite — el kernel no lleva reglas de ningún dominio de serie", () => {
    const { policy } = parsePolicy(null);
    expect(evalWrite(policy, "clerk", ".karajan/hooks/pre-commit").decision).toBe("allow");
  });

  it("los defaults sobreviven a un YAML invalido — la evaluacion nunca se queda sin ellos", () => {
    const { policy, errors } = parsePolicy("version: [broken", { defaults: LEDGER_DEFAULTS });
    expect(errors.length).toBeGreaterThan(0);
    expect(evalWrite(policy, "clerk", "sealed/x").decision).toBe("deny");
  });

  it("checkArtifacts evalua artefactos y metricas sin saber que son ficheros de git", () => {
    const { policy } = parsePolicy("version: 1\ninvariants:\n  - { id: budget, kind: diff-threshold, metric: net_lines_added, max: 10, enforcement: deny }\n", { defaults: LEDGER_DEFAULTS });
    const vs = checkArtifacts(policy, { role: "clerk", files: ["sealed/y", "open/z"], netLinesAdded: 99 });
    expect(vs.map((v) => v.rule_id).sort()).toEqual(["budget", "defaults.ledger.sealed"]);
  });
});
