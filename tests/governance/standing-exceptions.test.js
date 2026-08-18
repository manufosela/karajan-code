// GOV-B (KJC-TSK-0746) — la excepción con forma completa: scopeKind
// puntual|permanente (cerrado, fail-loud), expiresAt OBLIGATORIO en la
// permanente, grade en la identidad, y evaluateGate honrando standing
// exceptions VIVAS con un `now` explícito (determinismo: el reloj lo pone
// quien evalúa, no el kernel).

import { describe, it, expect, vi } from "vitest";
import { recordPolicyException } from "../../packages/governance/src/exceptions.js";
import { evaluateGate } from "../../packages/governance/src/gate.js";
import { parsePolicy } from "../../packages/governance/src/engine.js";

const deps = () => {
  const lines = [];
  return { lines, deps: { append: (_d, l) => lines.push(l), identity: () => ({ git: "manu <m@x>", os: "manu", grade: "declarada" }) } };
};

describe("recordPolicyException con alcance", () => {
  it("una permanente sin caducidad es invalida — sin expiresAt no hay excepcion permanente", () => {
    const { deps: d } = deps();
    expect(() => recordPolicyException({ projectDir: "/p", entry: { rule_id: "r", scopeKind: "permanente" }, deps: d })).toThrow(/expiresAt|caducidad/);
  });

  it("una caducidad ambigua (no ISO estricto) es invalida — Date.parse tragaba fechas locales (catch de codex)", () => {
    const { deps: d } = deps();
    for (const bad of ["next friday", "2026-9-1", "01/09/2026", "2026-09-01"]) {
      expect(() => recordPolicyException({ projectDir: "/p", entry: { rule_id: "r", scopeKind: "permanente", expiresAt: bad }, deps: d })).toThrow(/ISO/);
    }
  });

  it("un scopeKind fuera del vocabulario es invalido, no un default silencioso", () => {
    const { deps: d } = deps();
    expect(() => recordPolicyException({ projectDir: "/p", entry: { rule_id: "r", scopeKind: "eterna" }, deps: d })).toThrow(/scopeKind/);
  });

  it("un scopeKind undefined explicito no pisa el valor normalizado del registro (catch de codex)", () => {
    const { lines, deps: d } = deps();
    recordPolicyException({ projectDir: "/p", entry: { rule_id: "r", scopeKind: undefined }, deps: d });
    expect(JSON.parse(lines[0]).scopeKind).toBe("puntual");
  });

  it("la permanente valida registra scopeKind, expiresAt y el grade de la identidad", () => {
    const { lines, deps: d } = deps();
    const rec = recordPolicyException({
      projectDir: "/p",
      entry: { rule_id: "r", justification: "j", scopeKind: "permanente", expiresAt: "2026-09-01T00:00:00Z" },
      deps: d,
    });
    expect(rec.scopeKind).toBe("permanente");
    expect(JSON.parse(lines[0]).who.grade).toBe("declarada");
  });
});

const POLICY = `
version: 1
roles:
  coder:
    write: { deny: ["**/*.secret"], enforcement: deny }
`;

const standing = (expiresAt) => [{ rule_id: "roles.coder.write.deny", scopeKind: "permanente", expiresAt, justification: "campaña Q3" }];
const gate = ({ exceptions = [], now }) => {
  const { policy, errors } = parsePolicy(POLICY);
  return evaluateGate({ policy, errors, files: ["x.secret"], netLinesAdded: 1, standingExceptions: exceptions, now });
};

describe("evaluateGate con standing exceptions", () => {
  it("una permanente VIVA exime el deny de su regla referenciandola", () => {
    const res = gate({ exceptions: standing("2026-09-01T00:00:00Z"), now: new Date("2026-08-18T00:00:00Z") });
    expect(res.ok).toBe(true);
    expect(res.exempted[0]).toMatchObject({ rule_id: "roles.coder.write.deny", standing: expect.objectContaining({ expiresAt: "2026-09-01T00:00:00Z" }) });
  });

  it("caducada = deny de nuevo — la caducidad es la regla, no una sugerencia", () => {
    const res = gate({ exceptions: standing("2026-08-01T00:00:00Z"), now: new Date("2026-08-18T00:00:00Z") });
    expect(res.ok).toBe(false);
  });

  it("los registros legacy (PL-B, sin scopeKind) NO dan standing — su tipo efectivo era puntual (catch de codex)", () => {
    const res = gate({
      exceptions: [{ rule_id: "roles.coder.write.deny", justification: "legacy", diffHash: "abc", expiresAt: "2027-01-01T00:00:00Z" }],
      now: new Date("2026-08-18T00:00:00Z"),
    });
    expect(res.ok).toBe(false);
  });

  it("una standing de OTRA regla no exime nada", () => {
    const res = gate({
      exceptions: [{ rule_id: "roles.coder.shell.deny", scopeKind: "permanente", expiresAt: "2026-09-01T00:00:00Z" }],
      now: new Date("2026-08-18T00:00:00Z"),
    });
    expect(res.ok).toBe(false);
  });

  it("las inexcepcionables (security) NO se eximen ni con standing viva", () => {
    const { policy, errors } = parsePolicy(null, { defaults: [{ id: "defaults.x", pattern: /sealed\//, message: "sellado" }] });
    const res = evaluateGate({
      policy, errors, files: ["sealed/a"], netLinesAdded: 1,
      standingExceptions: [{ rule_id: "defaults.x", scopeKind: "permanente", expiresAt: "2027-01-01T00:00:00Z" }],
      now: new Date("2026-08-18T00:00:00Z"),
    });
    expect(res.ok).toBe(false);
  });
});
