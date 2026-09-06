// PL-E (KJC-TSK-0767) — `kj policy report` sobre los ficheros reales:
// lee los dos jsonl, imprime humano o --json, y una cadena rota es exit 1.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";
import { recordGateDecision } from "../../src/policy/decisions.js";
import { loadExceptionRecords, recordPolicyException } from "../../src/policy/exceptions.js";

let dir;
let home; // home temporal: el report también lee ~/.karajan (KJC-TSK-0813)
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-polreport-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-polreport-home-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.tmp'] }\n");
  process.chdir(dir);
});
const logger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};
const run = (log, flags = {}) => policyCommand({ action: "report", config: { projectDir: dir }, flags, logger: log, deps: { home } });
const grant = (until) => recordPolicyException({
  projectDir: dir, entry: { rule_id: "roles.coder.write.deny", justification: "j", scopeKind: "permanente", expiresAt: until },
  deps: { identity: () => ({ git: "t <t@t>", os: "t", grade: "declarada" }) },
});

describe("kj policy report", () => {
  it("sin ficheros: informe en ceros, exit 0, y lo dice", async () => {
    const log = logger();
    expect(await run(log)).toBe(0);
    expect(log.lines.join("\n")).toMatch(/0 decisiones[\s\S]*ninguna ha avisado/);
  });

  it("lee decisiones y concesiones reales; --json devuelve el objeto con exceptions_discarded", async () => {
    recordGateDecision(dir, { decision: "allow", chokepoint: "commit", warn_rule_ids: ["roles.coder.write.deny"] });
    recordGateDecision(dir, { decision: "deny", chokepoint: "commit", rule_ids: ["roles.coder.write.deny"] });
    grant("2099-01-01T00:00:00Z");
    grant("2099-06-01T00:00:00Z");
    fs.appendFileSync(path.join(dir, ".karajan", "policy-exceptions.jsonl"), "{rota\n");
    expect(loadExceptionRecords(dir)).toMatchObject({ discarded: 1 });
    const log = logger();
    expect(await run(log, { json: true })).toBe(0);
    const out = JSON.parse(log.lines.at(-1));
    expect(out.decisions).toMatchObject({ total: 2, allow: 1, deny: 1, open: 1 });
    expect(out.rules[0]).toMatchObject({ rule_id: "roles.coder.write.deny", warns: 1, denies: 1, enforcement: "warn" });
    expect(out.grants.renewals).toEqual([{ rule_id: "roles.coder.write.deny", count: 2 }]);
    expect(out.exceptions_discarded).toBe(1);
    const human = logger();
    await run(human);
    expect(human.lines.join("\n")).toMatch(/concedida 2 veces/);
    expect(human.lines.join("\n")).toMatch(/líneas corruptas descartadas: 0 en decisiones, 1 en excepciones/);
  });

  it("cadena manipulada = exit 1 gritando, con el informe igualmente impreso", async () => {
    recordGateDecision(dir, { decision: "deny", rule_ids: ["r1"] });
    recordGateDecision(dir, { decision: "allow" });
    const p = path.join(dir, ".karajan", "policy-decisions.jsonl");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('"deny"', '"allow"'));
    const log = logger();
    expect(await run(log)).toBe(1);
    expect(log.lines.join("\n")).toMatch(/cadena rota en la entrada 1[\s\S]*decisiones: allow 2/);
  });
});
