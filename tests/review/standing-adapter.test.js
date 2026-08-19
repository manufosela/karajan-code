// GOV-B (KJC-TSK-0746) parte 2 — el adaptador de code: carga tolerante de
// standing exceptions del jsonl (la línea corrupta se descarta CONTANDO,
// jamás rompe el gate), identidad con grade declarada, kj policy grant
// crea la permanente completa, y kj review honra la standing viva.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const reviewMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: vi.fn().mockResolvedValue({ available: false, reason: "test" }),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));

import { loadStandingExceptions } from "../../src/policy/exceptions.js";
import { policyCommand } from "../../src/commands/policy.js";
import { reviewGateCommand } from "../../src/commands/review-gate.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-standing-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, "base.js"), "base\n");
  git("add", "base.js"); git("commit", "-qm", "base");
  fs.writeFileSync(
    path.join(dir, ".karajan", "policy.yml"),
    "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n"
  );
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
});

const JSONL = path.join.bind(path);
const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("loadStandingExceptions", () => {
  it("carga solo permanentes y cuenta descartes (corruptas y puntuales) sin romper", () => {
    expect(loadStandingExceptions(dir)).toEqual({ standing: [], discarded: 0 }); // sin fichero = vacio
    fs.writeFileSync(JSONL(dir, ".karajan", "policy-exceptions.jsonl"), [
      JSON.stringify({ rule_id: "a", scopeKind: "permanente", expiresAt: "2027-01-01T00:00:00Z" }),
      JSON.stringify({ rule_id: "b", scopeKind: "puntual", diffHash: "x" }),
      "esto no es json",
      "null",
      "",
    ].join("\n"));
    const res = loadStandingExceptions(dir);
    expect(res.standing).toHaveLength(1);
    expect(res.standing[0].rule_id).toBe("a");
    expect(res.discarded).toBe(2);
  });

});

describe("kj policy grant", () => {
  it("crea la permanente completa en el jsonl, con la identidad en grade declarada", async () => {
    const logs = [];
    const code = await policyCommand({
      action: "grant",
      config: { projectDir: dir },
      flags: { rule: "roles.coder.write.deny", until: "2027-01-01T00:00:00Z", reason: "campaña Q3 autorizada" },
      logger: { info: (m) => logs.push(m), error: (m) => logs.push(m) },
    });
    expect(code).toBe(0);
    const rec = JSON.parse(fs.readFileSync(JSONL(dir, ".karajan", "policy-exceptions.jsonl"), "utf8").trim());
    expect(rec).toMatchObject({ rule_id: "roles.coder.write.deny", scopeKind: "permanente", expiresAt: "2027-01-01T00:00:00Z", justification: "campaña Q3 autorizada" });
    expect(rec.who.grade).toBe("declarada"); // git+os es atribucion, no autenticacion
  });

  it("la renovacion como señal (GOV-E): la 3ª concesion sobre la MISMA regla lo dice y sugiere cambiar la politica", async () => {
    const logs = [];
    const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
    const grant = (rule, until) => policyCommand({ action: "grant", config: { projectDir: dir }, flags: { rule, until, reason: "r" }, logger });
    expect(await grant("roles.coder.write.deny", "2026-01-01T00:00:00Z")).toBe(0);
    expect(await grant("roles.coder.shell.deny", "2026-02-01T00:00:00Z")).toBe(0); // otra regla: no cuenta
    expect(logs.join("\n")).not.toMatch(/concesión/);
    expect(await grant("roles.coder.write.deny", "2026-03-01T00:00:00Z")).toBe(0);
    expect(await grant("roles.coder.write.deny", "2027-01-01T00:00:00Z")).toBe(0); // 3ª de write.deny
    const out = logs.join("\n");
    expect(out).toMatch(/3ª concesión sobre esta regla/);
    expect(out).toMatch(/cambiar la política|PR/);
  });

  it("se niega sobre defaults.*, sobre caps class=security (catch de codex) y sin reason/until", async () => {
    const err = [];
    const logger = { info: () => {}, error: (m) => err.push(m) };
    expect(await policyCommand({ action: "grant", config: { projectDir: dir }, flags: { rule: "defaults.supervisor.write", until: "2027-01-01T00:00:00Z", reason: "x" }, logger })).toBe(1);
    fs.writeFileSync(JSONL(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    shell: { deny: ['curl *'], enforcement: deny, class: security }\n");
    expect(await policyCommand({ action: "grant", config: { projectDir: dir }, flags: { rule: "roles.coder.shell.deny", until: "2027-01-01T00:00:00Z", reason: "x" }, logger })).toBe(1);
    expect(await policyCommand({ action: "grant", config: { projectDir: dir }, flags: { rule: "roles.coder.write.deny", reason: "x" }, logger })).toBe(1);
    expect(await policyCommand({ action: "grant", config: { projectDir: dir }, flags: { rule: "roles.coder.write.deny", until: "2027-01-01T00:00:00Z" }, logger })).toBe(1);
  });
});

describe("review gate con standing", () => {
  const runGateWithStanding = async (expiresAt) => {
    fs.writeFileSync(JSONL(dir, ".karajan", "policy-exceptions.jsonl"),
      `${JSON.stringify({ rule_id: "roles.coder.write.deny", scopeKind: "permanente", expiresAt, justification: "j" })}\n`);
    fs.writeFileSync(path.join(dir, "prod.secret"), "x\n");
    execFileSync("git", ["-C", dir, "add", "prod.secret"]);
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    return r;
  };

  it("una permanente viva exime el deny", async () => {
    expect((await runGateWithStanding("2099-01-01T00:00:00Z")).verdict).toBe("approved");
  });

  it("caducada = deny — el gate vuelve a cerrar solo", async () => {
    expect(await runGateWithStanding("2020-01-01T00:00:00Z")).toMatchObject({ verdict: "rejected", reviewer: "policy" });
  });
});
