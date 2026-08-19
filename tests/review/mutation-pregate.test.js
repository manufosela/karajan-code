// MUT-A (KJC-TSK-0716, épica KJC-PCS-0072) — el mutation pre-gate: opt-in
// (mutation es cara), solo en --staged, supervivientes como advisory al
// reviewer, y con block la lista exacta con remediación ANTES de gastar
// reviewer. Indisponible = degrada AVISANDO, jamás en silencio.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runMutationPregate, formatSurvivor } from "../../src/review/mutation-pregate.js";

const reviewMock = vi.fn();
vi.mock("../../src/review/one-shot-review.js", () => ({ runOneShotReview: (...a) => reviewMock(...a) }));
vi.mock("../../src/review/sonar-pregate.js", async (orig) => ({
  ...(await orig()), runSonarPregate: vi.fn().mockResolvedValue({ available: false, reason: "test" }),
}));
vi.mock("../../src/review/card-first.js", async (orig) => ({
  ...(await orig()), checkCardFirst: vi.fn().mockResolvedValue({ ok: true, mode: "pass" }),
}));
vi.mock("../../src/review/mutation-pregate.js", async (orig) => {
  const real = await orig();
  return { ...real, runMutationPregate: vi.fn(real.runMutationPregate) };
});
import { reviewGateCommand } from "../../src/commands/review-gate.js";

const outcome = (survived, extra = {}) => ({
  result: { score: 80, killed: 8, total: 10, survived, ...extra },
});

describe("wiring en review-gate: --range NUNCA consulta el indice (catch de codex)", () => {
  let dir;
  const cwd0 = process.cwd();
  afterEach(() => { process.chdir(cwd0); });
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mutrange-"));
    const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t"); git("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "a.js"), "base\n");
    git("add", "a.js"); git("commit", "-qm", "base");
    fs.writeFileSync(path.join(dir, "a.js"), "cambio\n");
    fs.writeFileSync(path.join(dir, "a.test.js"), "t\n");
    git("add", "-A"); git("commit", "-qm", "cambio");
    process.chdir(dir);
    reviewMock.mockResolvedValue({ verdict: "approved", reviewer: "codex", diffHash: "abc123456789" });
  });

  it("con --range el pregate ni se invoca aunque method_gates.mutation este activo", async () => {
    const { runMutationPregate: spy } = await import("../../src/review/mutation-pregate.js");
    const spy2 = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await reviewGateCommand({ config: { projectDir: dir, method_gates: { mutation: "block" } }, flags: { range: "HEAD~1...HEAD" } });
    spy2.mockRestore();
    expect(spy).not.toHaveBeenCalled();
    expect(r.verdict).toBe("approved");
  });
});

describe("runMutationPregate", () => {
  it("sin method_gates.mutation NO corre — la mutación es opt-in", async () => {
    const mutate = vi.fn();
    const res = await runMutationPregate({ config: {}, deps: { mutateFn: mutate } });
    expect(res.enabled).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("warn: supervivientes viajan como advisory, el gate no cierra", async () => {
    const survived = [{ file: "src/a.js", line: 12, mutator: "ArithmeticOperator" }];
    const res = await runMutationPregate({
      config: { method_gates: { mutation: "warn" } },
      deps: { mutateFn: async () => outcome(survived) },
    });
    expect(res).toMatchObject({ enabled: true, ok: true });
    expect(res.survived).toHaveLength(1);
  });

  it("block: cierra con la lista exacta y remediación, sin tocar al reviewer", async () => {
    const survived = [
      { file: "src/a.js", line: 12, mutator: "ArithmeticOperator" },
      { file: "src/b.js", line: 3, mutator: "ConditionalExpression" },
    ];
    const res = await runMutationPregate({
      config: { method_gates: { mutation: "block" } },
      deps: { mutateFn: async () => outcome(survived) },
    });
    expect(res.ok).toBe(false);
    expect(res.survived).toHaveLength(2);
    expect(formatSurvivor(survived[0])).toMatch(/src\/a\.js:12.*ArithmeticOperator/);
  });

  it("cero supervivientes = gate abierto en block", async () => {
    const res = await runMutationPregate({
      config: { method_gates: { mutation: "block" } },
      deps: { mutateFn: async () => outcome([]) },
    });
    expect(res.ok).toBe(true);
  });

  it("payload malformado del runner degrada igual que el error — jamas crashea el gate (catch de codex)", async () => {
    for (const bad of [{}, { result: null }, { result: { survived: "no-array" } }]) {
      const res = await runMutationPregate({ config: { method_gates: { mutation: "block" } }, deps: { mutateFn: async () => bad } });
      expect(res).toMatchObject({ enabled: true, ok: true, available: false });
    }
  });

  it("herramienta/lenguaje indisponible degrada AVISANDO — nunca un pase silencioso ni un cierre injusto", async () => {
    const res = await runMutationPregate({
      config: { method_gates: { mutation: "block" } },
      deps: { mutateFn: async () => { throw new Error("stryker no instalado"); } },
    });
    expect(res).toMatchObject({ enabled: true, ok: true, available: false });
    expect(res.reason).toMatch(/stryker/);
  });
});
