// KJC-TSK-0813 PR-1 — excepciones con ámbito: almacén de proyecto
// (.karajan/ del repo) o GLOBAL (~/.karajan/). La procedencia es FÍSICA:
// el origin se estampa según el almacén del que se leyó cada línea,
// ignorando lo que la línea declare — no se puede mentir sobre el origen.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateGate } from "@karajan-family/governance";
import { loadStandingExceptions, recordPolicyException } from "../../src/policy/exceptions.js";
import { policyCommand } from "../../src/commands/policy.js";
import { loadPolicy } from "../../src/policy/engine.js";

const DENY_POLICY = "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n";
const SEC_POLICY = "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny, class: security }\n";
const RULE = "roles.coder.write.deny";
const FAR = "2099-01-01T00:00:00Z";
const jsonl = (root) => path.join(root, ".karajan", "policy-exceptions.jsonl");
const writeStore = (root, lines) => {
  fs.mkdirSync(path.join(root, ".karajan"), { recursive: true });
  fs.writeFileSync(jsonl(root), `${lines.join("\n")}\n`);
};

let dir;
let home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-scoped-proj-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-scoped-home-"));
});

describe("kj policy grant --global", () => {
  it("escribe en <home>/.karajan y NO en el proyecto, y el mensaje dice el ámbito", async () => {
    const logs = [];
    const code = await policyCommand({
      action: "grant", config: { projectDir: dir },
      flags: { rule: RULE, until: FAR, reason: "flota entera de esta máquina", global: true },
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
      deps: { readFile: () => DENY_POLICY, home },
    });
    expect(code).toBe(0);
    const rec = JSON.parse(fs.readFileSync(jsonl(home), "utf8").trim());
    expect(rec).toMatchObject({ rule_id: RULE, scopeKind: "permanente", expiresAt: FAR, origin: "global" });
    expect(fs.existsSync(jsonl(dir))).toBe(false);
    expect(logs.join("\n")).toContain("ámbito global — todos tus proyectos de esta máquina");
  });
});

describe("loadStandingExceptions fusionada", () => {
  it("fusiona ambos almacenes con origin FÍSICO (una global que declare project sale global) y suma descartes", () => {
    writeStore(dir, [JSON.stringify({ rule_id: "p.rule", scopeKind: "permanente", expiresAt: FAR, origin: "global" }), "no-json"]);
    writeStore(home, [JSON.stringify({ rule_id: "g.rule", scopeKind: "permanente", expiresAt: FAR, origin: "project" }), "null"]);
    const { standing, discarded } = loadStandingExceptions(dir, { home });
    expect(standing).toHaveLength(2);
    expect(standing.find((s) => s.rule_id === "p.rule").origin).toBe("project");
    expect(standing.find((s) => s.rule_id === "g.rule").origin).toBe("global");
    expect(discarded).toBe(2);
  });
});

describe("recordPolicyException con scope", () => {
  const deps = () => ({ home, identity: () => ({ grade: "declarada" }), append: () => {} });

  it("global con scopeKind puntual o sin expiresAt es TypeError — un global puntual no existe", () => {
    expect(() => recordPolicyException({ projectDir: dir, entry: { rule_id: RULE, scopeKind: "puntual" }, deps: deps(), scope: "global" }))
      .toThrow(/permanente/);
    expect(() => recordPolicyException({ projectDir: dir, entry: { rule_id: RULE, scopeKind: "permanente" }, deps: deps(), scope: "global" }))
      .toThrow(TypeError);
  });

  it("scope desconocido es TypeError", () => {
    expect(() => recordPolicyException({ projectDir: dir, entry: { rule_id: RULE, scopeKind: "permanente", expiresAt: FAR }, deps: deps(), scope: "machine" }))
      .toThrow(/project o global/);
  });
});

describe("standing global en evaluateGate", () => {
  const gate = (yaml) => {
    writeStore(home, [JSON.stringify({ rule_id: RULE, scopeKind: "permanente", expiresAt: FAR, justification: "j" })]);
    const { policy, errors } = loadPolicy({ projectDir: dir, deps: { readFile: () => yaml } });
    const { standing } = loadStandingExceptions(dir, { home });
    return evaluateGate({ policy, errors, files: ["prod.secret"], standingExceptions: standing });
  };

  it("una permanente global VIVA exime el deny y el exempted lleva la procedencia", () => {
    const res = gate(DENY_POLICY);
    expect(res.ok).toBe(true);
    expect(res.exempted).toHaveLength(1);
    expect(res.exempted[0].standing.origin).toBe("global");
  });

  it("lo security sigue sin eximirse aunque haya standing global", () => {
    const res = gate(SEC_POLICY);
    expect(res.ok).toBe(false);
    expect(res.denials[0].class).toBe("security");
    expect(res.exempted).toHaveLength(0);
  });
});
