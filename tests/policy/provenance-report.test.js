// KJC-TSK-0813 PR-2 — AC3: el informe y el gate dicen la PROCEDENCIA de
// cada exención aplicada; una decisión influida por un grant global lo dice.
// Con 0 globales el texto queda EXACTAMENTE como hoy (no romper consumidores).
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";
import { formatExempted } from "../../src/commands/review-gate.js";
import { evaluatePolicyGate } from "../../src/review/policy-gate.js";
import { loadStandingExceptions } from "../../src/policy/exceptions.js";
import { loadPolicy } from "../../src/policy/engine.js";

const FAR = "2099-01-01T00:00:00Z";
const DENY_POLICY = "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n";
const jsonl = (root) => path.join(root, ".karajan", "policy-exceptions.jsonl");
const store = (root, lines) => {
  fs.mkdirSync(path.join(root, ".karajan"), { recursive: true });
  fs.writeFileSync(jsonl(root), `${lines.join("\n")}\n`);
};
const perm = (rule, extra = {}) =>
  JSON.stringify({ rule_id: rule, scopeKind: "permanente", expiresAt: FAR, justification: "j", who: { git: "t <t@t>" }, ...extra });

let dir;
let home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-prov-proj-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-prov-home-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.tmp'] }\n");
});

const logger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};
const report = (log, flags = {}) => policyCommand({ action: "report", config: { projectDir: dir }, flags, logger: log, deps: { home } });

describe("kj policy report con almacén global", () => {
  it("--json incluye la global con origin global y la de proyecto con project", async () => {
    store(dir, [perm("p.rule")]);
    store(home, [perm("g.rule", { origin: "project" })]); // la línea miente: el FÍSICO manda
    const log = logger();
    expect(await report(log, { json: true })).toBe(0);
    const out = JSON.parse(log.lines.at(-1));
    expect(out.grants.alive.find((e) => e.rule_id === "p.rule").origin).toBe("project");
    expect(out.grants.alive.find((e) => e.rule_id === "g.rule").origin).toBe("global");
  });

  it("el texto marca [global] la concesión global y el resumen desglosa", async () => {
    store(dir, [perm("p.rule")]);
    store(home, [perm("g.rule")]);
    const log = logger();
    expect(await report(log)).toBe(0);
    const out = log.lines.join("\n");
    expect(out).toContain("concesiones: vivas 2 (1 globales, próximas a vencer 0) · vencidas 0 · puntuales 0");
    expect(out).toContain(`  [g.rule] hasta ${FAR} [global] — t <t@t>: j`);
    expect(out).toContain(`  [p.rule] hasta ${FAR} — t <t@t>: j`);
  });

  it("con 0 globales el resumen queda EXACTAMENTE como hoy y los descartes globales cuentan", async () => {
    store(dir, [perm("p.rule")]);
    store(home, ["{rota"]);
    const log = logger();
    expect(await report(log)).toBe(0);
    expect(log.lines).toContain("concesiones: vivas 1 (próximas a vencer 0) · vencidas 0 · puntuales 0");
    expect(log.lines.join("\n")).not.toContain("[global]");
    expect(log.lines.join("\n")).toContain("0 en decisiones, 1 en excepciones");
  });
});

describe("review gate — la exención dice su ámbito", () => {
  const exempted = (origin) => ({ rule_id: "r", standing: { expiresAt: FAR, justification: "j", origin } });

  it("un standing global lo nombra en la línea", () => {
    expect(formatExempted(exempted("global"))).toBe(`⚠ policy standing [r] — excepción permanente GLOBAL viva hasta ${FAR} (j)`);
  });

  it("un standing de proyecto queda EXACTAMENTE como hoy", () => {
    expect(formatExempted(exempted("project"))).toBe(`⚠ policy standing [r] — excepción permanente viva hasta ${FAR} (j)`);
  });

  it("el exempted que llega al sello conserva el origin del standing (viene de la fusión)", () => {
    store(home, [perm("roles.coder.write.deny")]);
    const { policy, errors } = loadPolicy({ projectDir: dir, deps: { readFile: () => DENY_POLICY } });
    const std = loadStandingExceptions(dir, { home });
    const gate = evaluatePolicyGate({ policy, errors, files: ["a.secret"], netLinesAdded: 1, diffHashValue: "x", standingExceptions: std.standing });
    expect(gate.ok).toBe(true);
    expect(gate.exempted[0].standing.origin).toBe("global");
  });
});
