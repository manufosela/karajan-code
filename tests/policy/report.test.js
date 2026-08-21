// PL-E (KJC-TSK-0767) — kj policy report: el dato que falta para que "una
// regla nace avisando y gana dientes" y "la renuncia deja rastro" sean
// afirmaciones comprobables, no frases. Módulo PURO: líneas del decision
// log + registros de excepciones + policy + reloj ⇒ informe determinista.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildPolicyReport } from "../../src/policy/report.js";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
/** Encadena entradas como lo haría recordDecision (prev = sha256 de la línea previa). */
const chain = (entries) => {
  const lines = [];
  for (const e of entries) lines.push(JSON.stringify({ ts: "2026-08-21T00:00:00Z", ...e, prev: lines.length ? sha(lines.at(-1)) : null }));
  return lines;
};
const NOW = new Date("2026-08-21T12:00:00Z");
const day = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const perm = (rule_id, days, extra = {}) => ({ rule_id, scopeKind: "permanente", expiresAt: day(days), justification: "x", ...extra });
const policy = {
  roles: { coder: { write: { enforcement: "deny", class: "security" }, shell: { enforcement: "warn" } } },
  invariants: [{ id: "loc.max", enforcement: "warn" }],
};

describe("buildPolicyReport — decisiones", () => {
  it("cuenta por decisión y por chokepoint y verifica la cadena", () => {
    const lines = chain([
      { decision: "deny", chokepoint: "commit", rule_ids: ["roles.coder.write.deny"] },
      { decision: "exempt", chokepoint: "review", rule_ids: ["roles.coder.shell.deny"] },
      { decision: "allow", chokepoint: "commit" },
    ]);
    const r = buildPolicyReport({ decisionLines: lines, now: NOW });
    expect(r.chain).toEqual({ ok: true, length: 3 });
    expect(r.decisions).toMatchObject({ total: 3, allow: 1, deny: 1, exempt: 1, chokepoints: { commit: 2, review: 1 } });
  });

  it("cadena rota se dice (ok=false, at) y el informe sigue contando; líneas no parseables se cuentan como discarded", () => {
    const lines = chain([{ decision: "deny", rule_ids: ["a"] }, { decision: "allow" }]);
    lines[0] = lines[0].replace('"deny"', '"allow"');
    const r = buildPolicyReport({ decisionLines: [...lines, "{nope"], now: NOW });
    expect(r.chain).toMatchObject({ ok: false, at: 1 });
    expect(r.decisions).toMatchObject({ total: 2, discarded: 1 });
  });

  it("tabla por regla: warn_rule_ids cuenta avisos; deny/exempt por rule_ids; enforcement y clase salen de la policy", () => {
    const lines = chain([
      { decision: "allow", chokepoint: "commit", warn_rule_ids: ["roles.coder.shell.deny", "loc.max"] },
      { decision: "allow", chokepoint: "commit", warn_rule_ids: ["loc.max"] },
      { decision: "deny", chokepoint: "commit", rule_ids: ["roles.coder.write.deny"] },
      { decision: "exempt", chokepoint: "commit", rule_ids: ["roles.coder.shell.deny"] },
      { decision: "allow", chokepoint: "commit" },
    ]);
    const r = buildPolicyReport({ decisionLines: lines, policy, now: NOW });
    const by = Object.fromEntries(r.rules.map((x) => [x.rule_id, x]));
    expect(by["loc.max"]).toMatchObject({ warns: 2, denies: 0, exempts: 0, enforcement: "warn" });
    expect(by["roles.coder.shell.deny"]).toMatchObject({ warns: 1, exempts: 1, enforcement: "warn" });
    expect(by["roles.coder.write.deny"]).toMatchObject({ denies: 1, enforcement: "deny", class: "security" });
    expect(by["roles.coder.write.deny"].open).toBe(0);
  });

  it("denegaciones abiertas = denies posteriores al último allow/exempt (el log acaba en rechazo)", () => {
    const lines = chain([
      { decision: "deny", rule_ids: ["r1"] },
      { decision: "allow", chokepoint: "commit" },
      { decision: "deny", rule_ids: ["r1"] },
      { decision: "deny", rule_ids: ["r1", "r2"] },
    ]);
    const r = buildPolicyReport({ decisionLines: lines, now: NOW });
    const by = Object.fromEntries(r.rules.map((x) => [x.rule_id, x]));
    expect(by.r1).toMatchObject({ denies: 3, open: 2 });
    expect(by.r2).toMatchObject({ denies: 1, open: 1 });
    expect(r.decisions.open).toBe(2);
  });

});

describe("buildPolicyReport — concesiones", () => {
  it("separa vivas, vencidas y próximas a vencer; las puntuales solo se cuentan", () => {
    const recs = [perm("a", 30), perm("b", -1), perm("c", 3), { rule_id: "d", scopeKind: "puntual", diffHash: "h" }, { rule_id: "e" }];
    const r = buildPolicyReport({ exceptionRecords: recs, now: NOW, soonDays: 7 });
    expect(r.grants.alive.map((g) => g.rule_id)).toEqual(["a", "c"]);
    expect(r.grants.expired.map((g) => g.rule_id)).toEqual(["b"]);
    expect(r.grants.soon.map((g) => g.rule_id)).toEqual(["c"]);
    expect(r.grants.point).toBe(2);
  });

  it("renovaciones: ≥2 permanentes sobre la misma regla (vencidas incluidas) son señal de política pidiendo cambio", () => {
    const recs = [perm("a", -30), perm("a", -1), perm("a", 20), perm("b", 10)];
    const r = buildPolicyReport({ exceptionRecords: recs, now: NOW });
    expect(r.grants.renewals).toEqual([{ rule_id: "a", count: 3 }]);
    expect(r.signals.some((s) => /a.*3/.test(s))).toBe(true);
  });

  it("señales: regla warn con avisos repetidos y sin deny pide decisión (promover o retirar); sin datos no hay señales", () => {
    const lines = chain(Array.from({ length: 5 }, () => ({ decision: "allow", chokepoint: "commit", warn_rule_ids: ["loc.max"] })));
    const r = buildPolicyReport({ decisionLines: lines, policy, now: NOW });
    expect(r.signals.some((s) => /loc\.max/.test(s) && /5/.test(s))).toBe(true);
    expect(buildPolicyReport({ now: NOW }).signals).toEqual([]);
  });
});
