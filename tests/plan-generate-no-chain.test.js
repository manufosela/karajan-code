/**
 * KJC-BUG-0041 — `kj plan generate` no debe encadenar HUs por orden
 * de aparición. Pre-fix, el loop de `planGenerateImpl` rellenaba
 * `blocked_by: [previousHuId]` para cada HU aunque el output del
 * planner role NO modela dependencias. Resultado: cadena lineal
 * artificial que serializaba todo el trabajo paralelizable.
 *
 * Este test bloquea la regresión: tras llamar al comando con un
 * planner que devuelve N steps simples (sin deps en su output),
 * todos los HUs del plan resultante deben tener `blocked_by: []`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadOnlyPlan() {
  const root = join(process.env.KJ_HOME, "plans");
  const projectDirs = readdirSync(root);
  for (const projDir of projectDirs) {
    const projPath = join(root, projDir);
    const files = readdirSync(projPath).filter((f) => f.startsWith("plan-") && f.endsWith(".json"));
    if (files.length > 0) {
      return JSON.parse(readFileSync(join(projPath, files[0]), "utf8"));
    }
  }
  throw new Error("no plan written under KJ_HOME/plans");
}

vi.mock("../src/agents/index.js", () => ({ createAgent: vi.fn() }));
vi.mock("../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({ provider: config.roles?.[role]?.provider || "claude" })),
}));
vi.mock("../src/prompts/planner.js", () => ({
  buildPlannerPrompt: vi.fn().mockReturnValue("planner prompt"),
}));

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn(),
};

const sixSteps = JSON.stringify({
  approach: "Build the foundation in six independent slices",
  steps: [
    { description: "Setup GCP project + Firebase", acceptance_tests: [{ type: "shell", content: "test 1" }] },
    { description: "Enable GCIP multi-tenancy",     acceptance_tests: [{ type: "shell", content: "test 2" }] },
    { description: "Create KMS keyring per org",    acceptance_tests: [{ type: "shell", content: "test 3" }] },
    { description: "Wire CI/CD via GitHub Actions", acceptance_tests: [{ type: "shell", content: "test 4" }] },
    { description: "Set up audit log collection",   acceptance_tests: [{ type: "shell", content: "test 5" }] },
    { description: "Publish UI catalogue components", acceptance_tests: [{ type: "shell", content: "test 6" }] },
  ],
  risks: ["GCIP tenant limit"],
  outOfScope: ["IA / RAG"],
});

let tmpHome;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-plan-no-chain-"));
  process.env.KJ_HOME = tmpHome;
  vi.resetAllMocks();

  const agents = await import("../src/agents/index.js");
  agents.createAgent.mockReturnValue({
    runTask: vi.fn().mockResolvedValue({ ok: true, output: sixSteps, exitCode: 0 }),
  });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe("KJC-BUG-0041 — planGenerate must NOT chain HUs by order", () => {
  it("emits blocked_by: [] for every HU when the planner output declares no dependencies", async () => {
    const { planGenerateCommand } = await import("../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "Build the foundation",
      config: {
        roles: { planner: { provider: "claude" } },
        session: { max_iteration_minutes: 10 },
        projectDir: tmpHome,
      },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true },
    });

    const plan = loadOnlyPlan();
    expect(plan.hus).toHaveLength(6);
    for (const hu of plan.hus) {
      expect(hu.blocked_by).toEqual([]);
    }
  });

  it("does NOT chain HUs by their order of appearance (no HU lists its predecessor as blocker)", async () => {
    const { planGenerateCommand } = await import("../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "long plan",
      config: {
        roles: { planner: { provider: "claude" } },
        session: { max_iteration_minutes: 10 },
        projectDir: tmpHome,
      },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true },
    });

    const plan = loadOnlyPlan();
    // Classic chain-artefact: blocked_by[i] === [hus[i-1].id]. We assert
    // zero chained pairs — that's the strict regression invariant for
    // KJC-BUG-0041.
    const chained = plan.hus.slice(1).filter((hu, idx) => {
      const prevId = plan.hus[idx].id;
      return Array.isArray(hu.blocked_by) && hu.blocked_by.includes(prevId);
    });
    expect(chained, "no HU should declare its predecessor as a blocker").toEqual([]);
  });
});
