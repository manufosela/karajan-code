// KJC-TSK-0756 (campo, Pedro Amador) — el guarantee level se DECLARA en
// runtime: el acoplamiento a Claude es UNA capa (tier A, hooks síncronos)
// y decisión de ADR; el tier B es el suelo agnóstico y jamás se finge lo
// que no se puede aplicar.

import { describe, it, expect } from "vitest";
import { guaranteeLevel, collectGuaranteeFacts } from "../../src/checks/guarantee-level.js";

describe("guaranteeLevel", () => {
  it("host claude con harness: los tres tiers activos (con policy y workflow)", () => {
    const g = guaranteeLevel({ host: "claude", harnessWired: true, policyDeclared: true, policyWorkflow: true });
    expect(g.tierA.active).toBe(true);
    expect(g.tierB.active).toBe(true);
    expect(g.tierC.active).toBe(true);
  });

  it("host NO claude: tier A OFF con el porqué honesto, tier B sigue siendo el suelo", () => {
    const g = guaranteeLevel({ host: "codex", harnessWired: false, policyDeclared: false, policyWorkflow: false });
    expect(g.tierA.active).toBe(false);
    expect(g.tierA.reason).toMatch(/no expone hooks síncronos/);
    expect(g.tierA.reason).toMatch(/no se finge/);
    expect(g.tierB.active).toBe(true);
  });

  it("claude SIN harness: tier A OFF con remedio (kj harden), no con excusa", () => {
    const g = guaranteeLevel({ host: "claude", harnessWired: false, policyDeclared: false, policyWorkflow: false });
    expect(g.tierA.active).toBe(false);
    expect(g.tierA.reason).toMatch(/kj harden/);
  });

  it("tier C honesto: policy sin workflow = OFF con remedio; sin policy = OFF explicando que no hay qué verificar", () => {
    expect(guaranteeLevel({ host: "claude", harnessWired: true, policyDeclared: true, policyWorkflow: false }).tierC).toMatchObject({ active: false });
    expect(guaranteeLevel({ host: "claude", harnessWired: true, policyDeclared: false, policyWorkflow: false }).tierC.reason).toMatch(/sin .*policy/);
  });

  it("collectGuaranteeFacts lee los hechos del disco con deps inyectables", () => {
    const g = collectGuaranteeFacts({
      projectDir: "/p",
      deps: { detectHost: () => "gemini", exists: (p) => p.includes(".karajan") && p.endsWith("policy.yml") },
    });
    expect(g).toMatchObject({ host: "gemini", tierA: { active: false }, tierC: { active: false } });
    expect(g.tierC.reason).toMatch(/kj harden/); // declarada sin workflow: remedio, no excusa
  });
});
