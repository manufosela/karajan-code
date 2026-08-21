// KJC-TSK-0734 PL-B — el gate de policy cableado en kj review: deny cierra
// en --staged y en --check (el pre-commit hereda los dientes sin regenerar
// hooks) y la excepción probatoria queda registrada. El guard de solomon
// (clase seguridad no arbitrable) llega en el PR hermano.

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

import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => {
  process.chdir(cwd0);
  delete process.env.KJ_ALLOW_POLICY;
  delete process.env.KJ_POLICY_REASON;
});
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-polgate-"));
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

const stage = (name, content = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
  execFileSync("git", ["-C", dir, "add", name]);
};
const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("policy gate en kj review", () => {
  it("deny cierra el gate en --staged sin invocar al reviewer", async () => {
    stage("prod.secret");
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "policy" });
    expect(reviewMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("deny cierra tambien en --check — el pre-commit hereda los dientes", async () => {
    stage("prod.secret");
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { check: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "policy" });
  });

  it("la excepcion probatoria exime Y queda registrada en el jsonl", async () => {
    stage("prod.secret");
    process.env.KJ_ALLOW_POLICY = "1";
    process.env.KJ_POLICY_REASON = "hotfix aprobado";
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    expect(r.verdict).toBe("approved");
    const jsonl = fs.readFileSync(path.join(dir, ".karajan", "policy-exceptions.jsonl"), "utf8").trim();
    expect(JSON.parse(jsonl)).toMatchObject({ justification: "hotfix aprobado", scope: "este diff exacto" });
    expect(JSON.parse(jsonl).who.git).toContain("t@t");
  });

  it("los defaults del supervisor (class=security) no tienen escape", async () => {
    stage(".karajan/harness/evil.mjs");
    process.env.KJ_ALLOW_POLICY = "1";
    process.env.KJ_POLICY_REASON = "da igual";
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "policy" });
  });

  // PL-E (KJC-TSK-0767): los avisos se sellan en el allow del commit — son el
  // dato con el que una regla warn gana dientes (kj policy report).
  it("el allow de --check sella warn_rule_ids con las reglas que avisaron", async () => {
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.tmp'] }\n");
    stage("scratch.tmp");
    const staged = execFileSync("git", ["-C", dir, "diff", "--cached"], { encoding: "utf8" });
    await saveVerdict(dir, staged, { verdict: "approved", reviewer: "codex", issues: [] });
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { check: true } });
    spy.mockRestore();
    expect(r.ok).toBe(true);
    const last = fs.readFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "utf8").trim().split("\n").at(-1);
    expect(JSON.parse(last)).toMatchObject({ decision: "allow", chokepoint: "commit", warn_rule_ids: ["roles.coder.write.deny"] });
  });

  it("policy invalida = gate cerrado, jamas un pase silencioso", async () => {
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { allw: ['x'] }\n");
    stage("src/ok.js");
    const spy = silence();
    const r = await reviewGateCommand({ config: { projectDir: dir }, flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "policy" });
  });
});
