// GOV-C (KJC-TSK-0747) — decisiones de chokepoint append-only y
// hash-encadenadas: cada entrada referencia la anterior; editar o borrar
// una rompe la cadena de forma VERIFICABLE. El kernel no hace I/O.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recordDecision, verifyDecisionChain } from "@karajan-family/governance";
import { recordGateDecision, policyFileHash } from "../../src/policy/decisions.js";

const reviewMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: vi.fn().mockResolvedValue({ available: false, reason: "test" }),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));
vi.mock("../../src/review/verdict-store.js", async (orig) => ({
  ...(await orig()), checkVerdict: vi.fn().mockResolvedValue({ ok: true, verdict: { reviewer: "codex", diffHash: "abc123456789" } }),
}));

import { reviewGateCommand } from "../../src/commands/review-gate.js";

describe("kernel: recordDecision + verifyDecisionChain", () => {
  it("encadena por hash y la verificacion detecta manipulacion", () => {
    const lines = [];
    const deps = { append: (l) => lines.push(l), lastLine: () => lines.at(-1) ?? null };
    recordDecision({ entry: { decision: "deny", rule_ids: ["r1"] }, deps });
    recordDecision({ entry: { decision: "allow", artifact_hash: "abc" }, deps });
    expect(JSON.parse(lines[0]).prev).toBeNull();
    expect(JSON.parse(lines[1]).prev).toHaveLength(64);
    expect(verifyDecisionChain(lines)).toEqual({ ok: true, length: 2 });
    const tampered = [lines[0].replace("deny", "allow"), lines[1]];
    expect(verifyDecisionChain(tampered).ok).toBe(false);
    expect(verifyDecisionChain([lines[1]]).ok).toBe(false); // borrar la primera rompe
  });

  it("el kernel exige el almacen inyectado", () => {
    expect(() => recordDecision({ entry: { decision: "deny" } })).toThrow(/adaptador/);
  });
});

describe("adaptador + chokepoints", () => {
  let dir;
  const cwd0 = process.cwd();
  afterEach(() => { process.chdir(cwd0); });
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-decis-"));
    const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
    git("init", "-q");
    git("config", "user.email", "t@t"); git("config", "user.name", "t");
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base.js"), "base\n");
    git("add", "base.js"); git("commit", "-qm", "base");
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"),
      "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n");
    process.chdir(dir);
    reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
  });

  const stage = (name) => {
    fs.writeFileSync(path.join(dir, name), "x\n");
    execFileSync("git", ["-C", dir, "add", name]);
  };
  const log = () => fs.readFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("un deny en el gate queda registrado con policy_hash y artefacto (y sin policy el hash es null)", async () => {
    expect(policyFileHash(fs.mkdtempSync(path.join(os.tmpdir(), "kj-nopol-")))).toBeNull();
    stage("prod.secret");
    const spy = silence();
    await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    const [rec] = log();
    expect(rec).toMatchObject({ decision: "deny", chokepoint: "review" });
    expect(rec.rule_ids).toContain("roles.coder.write.deny");
    expect(rec.policy_hash).toHaveLength(64);
    expect(rec.artifact_hash).toHaveLength(64);
  });

  it("el allow del chokepoint de COMMIT (--check) se registra; el de --staged no", async () => {
    stage("src-ok.js");
    const spy = silence();
    await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    expect(fs.existsSync(path.join(dir, ".karajan", "policy-decisions.jsonl"))).toBe(false);
    await reviewGateCommand({ config: { projectDir: dir }, flags: { check: true } });
    spy.mockRestore();
    const recs = log();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ decision: "allow", chokepoint: "commit" });
  });

  it("recordGateDecision encadena en disco", () => {
    recordGateDecision(dir, { decision: "deny", rule_ids: ["x"] });
    recordGateDecision(dir, { decision: "allow" });
    const recs = log();
    expect(recs[1].prev).toHaveLength(64);
  });
});
