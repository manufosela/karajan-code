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

vi.mock("../../src/agents/index.js", () => ({ createAgent: vi.fn() }));
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
vi.mock("../../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({ provider: config.roles?.[role]?.provider || "claude" })),
}));
vi.mock("../../src/prompts/planner.js", () => ({
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

  const agents = await import("../../src/agents/index.js");
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
    const { planGenerateCommand } = await import("../../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "Build the foundation",
      config: {
        roles: { planner: { provider: "claude" } },
        session: { max_iteration_minutes: 10 },
        projectDir: tmpHome,
      },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true, preflightHu: false },
    });

    const plan = loadOnlyPlan();
    expect(plan.hus).toHaveLength(6);
    for (const hu of plan.hus) {
      expect(hu.blocked_by).toEqual([]);
    }
  });

  it("does NOT chain HUs by their order of appearance (no HU lists its predecessor as blocker)", async () => {
    const { planGenerateCommand } = await import("../../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "long plan",
      config: {
        roles: { planner: { provider: "claude" } },
        session: { max_iteration_minutes: 10 },
        projectDir: tmpHome,
      },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true, preflightHu: false },
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

describe("KJC-TSK-0382 follow-up — planner-emitted dependencies map to blocked_by", async () => {
  const planWithRealDeps = JSON.stringify({
    approach: "Three independent steps and one that waits for both",
    steps: [
      { id: "INFRA-001", description: "Bootstrap GCP", dependencies: [], acceptance_tests: [{ type: "shell", content: "t1" }] },
      { id: "INFRA-002", description: "Setup KMS",     dependencies: ["INFRA-001"], acceptance_tests: [{ type: "shell", content: "t2" }] },
      { id: "AUTH-001",  description: "Setup auth",    dependencies: ["INFRA-001"], acceptance_tests: [{ type: "shell", content: "t3" }] },
      { id: "AUTH-002",  description: "Login flow",    dependencies: ["AUTH-001", "INFRA-002"], acceptance_tests: [{ type: "shell", content: "t4" }] },
    ],
    risks: [], outOfScope: [],
  });

  it("translates planner dependencies (symbolic ids) into blocked_by (real hu ids)", async () => {
    const agents = await import("../../src/agents/index.js");
    agents.createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: planWithRealDeps, exitCode: 0 }),
    });

    const { planGenerateCommand } = await import("../../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "deps test",
      config: {
        roles: { planner: { provider: "claude" } },
        session: { max_iteration_minutes: 10 },
        projectDir: tmpHome,
      },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true, preflightHu: false },
    });

    const plan = loadOnlyPlan();
    expect(plan.hus).toHaveLength(4);
    const [infra1, infra2, auth1, auth2] = plan.hus;
    expect(infra1.blocked_by).toEqual([]);
    expect(infra2.blocked_by).toEqual([infra1.id]);
    expect(auth1.blocked_by).toEqual([infra1.id]);
    expect(auth2.blocked_by).toEqual([auth1.id, infra2.id]);
  });

  it("silently drops references to symbolic ids that don't exist in the plan", async () => {
    const orphanedDep = JSON.stringify({
      approach: "ok",
      steps: [
        { id: "STEP-A", description: "valid", dependencies: ["NONEXISTENT-001"], acceptance_tests: [{ type: "shell", content: "t" }] },
      ],
      risks: [], outOfScope: [],
    });
    const agents = await import("../../src/agents/index.js");
    agents.createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: orphanedDep, exitCode: 0 }),
    });

    const { planGenerateCommand } = await import("../../src/commands/plan/generate.js");
    await planGenerateCommand({
      task: "orphan deps test",
      config: { roles: { planner: { provider: "claude" } }, session: { max_iteration_minutes: 10 }, projectDir: tmpHome },
      logger: noopLogger,
      json: true,
      flags: { yes: true, interactive: false, "no-tests-synth": true, "no-plan-review": true, preflightHu: false },
    });

    const plan = loadOnlyPlan();
    expect(plan.hus[0].blocked_by).toEqual([]);
  });
});
