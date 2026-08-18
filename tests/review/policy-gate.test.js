// KJC-TSK-0734 PL-B — el gate determinista de policy en el flujo de review:
// deny rechaza, warn avisa, y la excepción sigue el modelo probatorio:
// quién (identidad) + regla exacta + justificación escrita EN el momento +
// alcance ligado al hash del diff (caducidad implícita). class=security no
// tiene escape.

import { describe, it, expect, vi } from "vitest";
import { evaluatePolicyGate } from "../../src/review/policy-gate.js";
import { recordPolicyException } from "../../src/policy/exceptions.js";
import { loadPolicy } from "../../src/policy/engine.js";

const load = (yamlText) => loadPolicy({ projectDir: "/p", deps: { readFile: () => yamlText } });

const DENY_POLICY = `
version: 1
roles:
  coder:
    write: { deny: ["**/*.env*"], enforcement: deny }
invariants:
  - { id: loc, kind: diff-threshold, metric: net_lines_added, max: 100, enforcement: warn }
`;

const run = ({ yaml = DENY_POLICY, files = [], net = 1, env = {}, record = vi.fn() } = {}) => {
  const { policy, errors } = load(yaml);
  return {
    record,
    res: evaluatePolicyGate({ policy, errors, files, netLinesAdded: net, diffHashValue: "abc123", env, recordException: record }),
  };
};

describe("evaluatePolicyGate", () => {
  it("policy invalida ⇒ gate cerrado con invalid (una regla que miente es peor que ninguna)", () => {
    const { res } = run({ yaml: "version: 7" });
    expect(res.ok).toBe(false);
    expect(res.invalid).toBe(true);
  });

  it("diff limpio ⇒ ok sin ruido", () => {
    const { res } = run({ files: ["src/ok.js"] });
    expect(res).toMatchObject({ ok: true, warns: [], denials: [], exempted: [] });
  });

  it("violacion warn avisa y NO cierra el gate", () => {
    const { res } = run({ files: ["src/ok.js"], net: 500 });
    expect(res.ok).toBe(true);
    expect(res.warns).toHaveLength(1);
  });

  it("violacion deny cierra el gate", () => {
    const { res } = run({ files: ["prod.env"] });
    expect(res.ok).toBe(false);
    expect(res.denials[0].rule_id).toBe("roles.coder.write.deny");
  });

  it("KJ_ALLOW_POLICY sin justificacion NO exime — la excepcion exige el porque escrito en el momento", () => {
    const { res, record } = run({ files: ["prod.env"], env: { KJ_ALLOW_POLICY: "1" } });
    expect(res.ok).toBe(false);
    expect(res.denials[0].reason).toMatch(/KJ_POLICY_REASON/);
    expect(record).not.toHaveBeenCalled();
  });

  it("KJ_ALLOW_POLICY + KJ_POLICY_REASON exime Y registra la excepcion completa", () => {
    const { res, record } = run({ files: ["prod.env"], env: { KJ_ALLOW_POLICY: "1", KJ_POLICY_REASON: "hotfix aprobado por manu" } });
    expect(res.ok).toBe(true);
    expect(res.exempted).toHaveLength(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: "roles.coder.write.deny",
      justification: "hotfix aprobado por manu",
      diffHash: "abc123",
    }));
  });

  it("class=security NO tiene escape — ni con justificacion", () => {
    const { res, record } = run({
      files: [".karajan/hooks/pre-commit"],
      env: { KJ_ALLOW_POLICY: "1", KJ_POLICY_REASON: "da igual" },
    });
    expect(res.ok).toBe(false);
    expect(res.denials[0].class).toBe("security");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("recordPolicyException", () => {
  it("registra jsonl con ts + quien (identidad, no proceso) + entrada", () => {
    const lines = [];
    const rec = recordPolicyException({
      projectDir: "/p",
      entry: { rule_id: "r", justification: "j", diffHash: "h" },
      deps: { append: (_dir, line) => lines.push(line), identity: () => ({ git: "manu <m@x>", os: "manu" }) },
    });
    expect(rec.who).toEqual({ git: "manu <m@x>", os: "manu" });
    expect(rec.ts).toBeTruthy();
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({ rule_id: "r", justification: "j", diffHash: "h" });
  });
});
