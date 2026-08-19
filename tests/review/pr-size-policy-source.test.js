// PL-C (KJC-TSK-0735) — fuente única de umbrales: cuando la policy declara
// el invariante net_lines_added, el aviso/gate pr-size del review LEE ESE
// max (el policy file GANA a method_gates); sin invariante, todo sigue como
// siempre. Un solo número para el aviso local y el gate de CI.

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

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-prsrc-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a.js"), "base\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  // 30 líneas añadidas + un test para no disparar tests-with-code.
  fs.writeFileSync(path.join(dir, "a.js"), Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n"));
  fs.writeFileSync(path.join(dir, "a.test.js"), "t\n");
  git("add", "-A");
  process.chdir(dir);
  reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
});

const withPolicyMax = (max) =>
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"),
    `version: 1\ninvariants:\n  - { id: loc-budget, kind: diff-threshold, metric: net_lines_added, max: ${max} }\n`);
const logs = () => {
  const out = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" ")));
  return { out, spy };
};

describe("pr-size con la policy como fuente unica", () => {
  it("el invariante de la policy GANA a method_gates.pr_size_warn", async () => {
    withPolicyMax(10);
    const { out, spy } = logs();
    await reviewGateCommand({ config: { projectDir: dir, method_gates: { pr_size_warn: 500 } }, flags: { staged: true } });
    spy.mockRestore();
    expect(out.join("\n")).toMatch(/pr-size.*(policy|loc-budget)/);
  });

  it("pr_size block usa el max de la policy y lo nombra", async () => {
    withPolicyMax(10);
    const { out, spy } = logs();
    const r = await reviewGateCommand({
      config: { projectDir: dir, method_gates: { pr_size: "block", pr_size_warn: 500 } },
      flags: { staged: true },
    });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "pr-size" });
    expect(out.join("\n")).toMatch(/10/);
  });

  it("sin invariante declarado, method_gates sigue mandando (sin policy no cambia nada)", async () => {
    const { out, spy } = logs();
    const r = await reviewGateCommand({ config: { projectDir: dir, method_gates: { pr_size_warn: 10, pr_size: "block" } }, flags: { staged: true } });
    spy.mockRestore();
    expect(r).toMatchObject({ verdict: "rejected", reviewer: "pr-size" });
    expect(out.join("\n")).not.toMatch(/policy file/);
  });
});
