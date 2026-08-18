// KJC-TSK-0734 PL-B — enforcement por regla (warn→deny), clase security y
// defaults embarcados del supervisor: las reglas antes hardcodeadas en el
// PRETOOL viven en el motor y NINGUNA policy de proyecto las debilita.

import { describe, it, expect } from "vitest";
import { checkStagedDiff, evalToolCall, loadPolicy } from "../../src/policy/engine.js";

const load = (yamlText) =>
  loadPolicy({ projectDir: "/p", deps: { readFile: () => yamlText } });

const POLICY = `
version: 1
roles:
  coder:
    write:
      deny: ["**/*.env*"]
      enforcement: deny
    shell:
      deny: ["git push*"]
invariants:
  - id: loc-budget
    kind: diff-threshold
    metric: net_lines_added
    max: 200
    enforcement: deny
`;

describe("vocabulario de enforcement (cerrado, fail-loud)", () => {
  it("acepta enforcement warn|deny en caps e invariants", () => {
    const { errors } = load(POLICY);
    expect(errors).toEqual([]);
  });

  it("un enforcement fuera del vocabulario es error de carga, no un default silencioso", () => {
    const { errors } = load(`
version: 1
roles:
  coder:
    write: { deny: ["a"], enforcement: block }
`);
    expect(errors.some((e) => e.includes("enforcement"))).toBe(true);
  });

  it("una class fuera del vocabulario es error de carga", () => {
    const { errors } = load(`
version: 1
roles:
  coder:
    write: { deny: ["a"], class: seguridad }
`);
    expect(errors.some((e) => e.includes("class"))).toBe(true);
  });

  it("enforcement invalido en un invariant es error de carga", () => {
    const { errors } = load(`
version: 1
invariants:
  - { id: x, kind: diff-threshold, metric: net_lines_added, max: 10, enforcement: hard }
`);
    expect(errors.some((e) => e.includes("enforcement"))).toBe(true);
  });
});

describe("enforcement viaja en el veredicto", () => {
  it("deny de un cap con enforcement=deny lo dice", () => {
    const { policy } = load(POLICY);
    const v = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "prod.env" } });
    expect(v.decision).toBe("deny");
    expect(v.enforcement).toBe("deny");
  });

  it("sin enforcement declarado, el default es warn (PL-A intacto)", () => {
    const { policy } = load(`
version: 1
roles:
  coder:
    write: { deny: ["secret/**"] }
`);
    const v = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "secret/x.js" } });
    expect(v.decision).toBe("deny");
    expect(v.enforcement).toBe("warn");
  });

  it("checkStagedDiff etiqueta cada violacion con su enforcement", () => {
    const { policy } = load(POLICY);
    const vs = checkStagedDiff(policy, { role: "coder", files: ["prod.env"], netLinesAdded: 500 });
    expect(vs).toHaveLength(2);
    for (const v of vs) expect(v.enforcement).toBe("deny");
  });

  it("invariant sin enforcement declara warn en la violacion", () => {
    const { policy } = load(`
version: 1
invariants:
  - { id: loc, kind: diff-threshold, metric: net_lines_added, max: 10 }
`);
    const vs = checkStagedDiff(policy, { files: [], netLinesAdded: 99 });
    expect(vs[0].enforcement).toBe("warn");
  });
});

describe("defaults del supervisor (antes hardcodeados en el PRETOOL)", () => {
  it("Write sobre los ficheros del supervisor deniega SIN policy de proyecto", () => {
    const { policy } = load(null);
    for (const target of [".claude/settings.json", ".karajan/hooks/pre-commit", ".karajan/harness/pretool.mjs"]) {
      const v = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: target } });
      expect(v.decision).toBe("deny");
      expect(v.enforcement).toBe("deny");
      expect(v.class).toBe("security");
    }
  });

  it("Bash que NOMBRA un fichero del supervisor deniega", () => {
    const { policy } = load(null);
    const v = evalToolCall(policy, { role: "coder", tool: "Bash", input: { command: "cp x .karajan/hooks/pre-commit" } });
    expect(v.decision).toBe("deny");
    expect(v.class).toBe("security");
  });

  it("la policy del proyecto NO debilita los defaults (deny gana)", () => {
    const { policy, errors } = load(`
version: 1
roles:
  coder:
    write: { allow: [".karajan/**", "src/**"] }
`);
    expect(errors).toEqual([]);
    const v = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: ".karajan/hooks/pre-commit" } });
    expect(v.decision).toBe("deny");
    expect(v.class).toBe("security");
  });

  it("checkStagedDiff marca ficheros del supervisor en el diff como security", () => {
    const { policy } = load(null);
    const vs = checkStagedDiff(policy, { role: "coder", files: [".karajan/harness/stop.mjs", "src/ok.js"], netLinesAdded: 1 });
    expect(vs).toHaveLength(1);
    expect(vs[0].class).toBe("security");
    expect(vs[0].enforcement).toBe("deny");
  });

  it("el resto del arbol sigue libre sin policy de proyecto", () => {
    const { policy } = load(null);
    const v = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "src/app.js" } });
    expect(v.decision).toBe("allow");
  });
});
