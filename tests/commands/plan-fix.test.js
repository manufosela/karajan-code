import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// KJC-TSK-0402: `kj plan fix [planId] [--prompt]` relanza self-fix sobre
// un plan ya generado. Tests cubren: prompt opcional, plan ya válido
// (no-op), persistencia.

vi.mock("../../src/agents/index.js", () => ({ createAgent: vi.fn() }));
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
vi.mock("../../src/config.js", async () => ({
  ...(await vi.importActual("../../src/config.js")),
  resolveRole: vi.fn(() => ({ provider: "claude" })),
}));
vi.mock("../../src/plan/plan-reviewer.js", async () => {
  const actual = await vi.importActual("../../src/plan/plan-reviewer.js");
  return { ...actual, reviewPlan: vi.fn() };
});
vi.mock("../../src/plan/plan-fixer.js", async () => {
  const actual = await vi.importActual("../../src/plan/plan-fixer.js");
  return { ...actual, applyReviewerFeedback: vi.fn() };
});

const EMPTY_FINDINGS = {
  missing_hus: [], missing_dependencies: [], scope_overlaps: [],
  order_issues: [], parallelisable_groups: [], summary: "OK",
};

let projectDir;
let kjHome;
const SAVED_KJ_HOME = process.env.KJ_HOME;

beforeEach(async () => {
  projectDir = mkdtempSync(path.join(tmpdir(), "kj-plan-fix-proj-"));
  kjHome = mkdtempSync(path.join(tmpdir(), "kj-plan-fix-home-"));
  process.env.KJ_HOME = kjHome;
  // Limpiar el mock entre tests para que .mock.calls[0] sea el de ESTE test.
  const { reviewPlan } = await import("../../src/plan/plan-reviewer.js");
  reviewPlan.mockClear();
});

afterEach(() => {
  if (SAVED_KJ_HOME === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = SAVED_KJ_HOME;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(kjHome, { recursive: true, force: true });
});

async function seedPlan(planId) {
  const { projectSlug } = await import("../../src/plan/plan-store.js");
  const slug = projectSlug(projectDir);
  const dir = path.join(kjHome, "plans", slug);
  mkdirSync(dir, { recursive: true });
  const plan = {
    version: 2, planId, name: "test", task: "Build a thing", status: "draft",
    hus: [
      { id: "hu_001", title: "A", task_type: "sw", status: "pending", blocked_by: [], reuse: [], scope: "a", acceptance_criteria: [], acceptance_tests: [], short_id: "X-1" },
      { id: "hu_002", title: "B", task_type: "sw", status: "pending", blocked_by: ["hu_001"], reuse: [], scope: "b", acceptance_criteria: [], acceptance_tests: [], short_id: "X-2" },
    ],
    review: null, createdAt: "2026-05-14T00:00:00Z", updatedAt: "2026-05-14T00:00:00Z",
  };
  writeFileSync(path.join(dir, `${planId}.json`), JSON.stringify(plan, null, 2));
  return { dir, plan };
}

describe("planFixCommand", () => {
  it("sin --prompt: reviewer ve task original, plan ya limpio → no-op log", async () => {
    await seedPlan("plan-clean");
    const { reviewPlan } = await import("../../src/plan/plan-reviewer.js");
    reviewPlan.mockResolvedValueOnce({ ok: true, findings: EMPTY_FINDINGS });
    const { planFixCommand } = await import("../../src/commands/plan/fix.js");
    const logger = { info: vi.fn(), warn: vi.fn() };
    const config = { projectDir };
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      await planFixCommand({ config, planId: "plan-clean", logger, json: false });
    } finally { console.log = origLog; }
    const reviewerCall = reviewPlan.mock.calls[0][0];
    expect(reviewerCall.task).toBe("Build a thing");
    expect(reviewerCall.task).not.toContain("USER FEEDBACK");
    expect(logs.some(l => l.includes("plan-clean"))).toBe(true);
  });

  it("con --prompt: el reviewer recibe USER FEEDBACK injection", async () => {
    await seedPlan("plan-prompt");
    const { reviewPlan } = await import("../../src/plan/plan-reviewer.js");
    reviewPlan.mockResolvedValueOnce({ ok: true, findings: EMPTY_FINDINGS });
    const { planFixCommand } = await import("../../src/commands/plan/fix.js");
    const config = { projectDir };
    const origLog = console.log;
    console.log = () => {};
    try {
      await planFixCommand({ config, planId: "plan-prompt", prompt: "falta HU export GDPR", logger: { info() {}, warn() {} }, json: true });
    } finally { console.log = origLog; }
    const reviewerCall = reviewPlan.mock.calls[0][0];
    expect(reviewerCall.task).toContain("USER FEEDBACK");
    expect(reviewerCall.task).toContain("falta HU export GDPR");
  });

  it("plan inexistente → error claro", async () => {
    const { planFixCommand } = await import("../../src/commands/plan/fix.js");
    await expect(
      planFixCommand({ config: { projectDir }, planId: "ghost", logger: { info() {}, warn() {} } })
    ).rejects.toThrow(/no encontrado/i);
  });

  it("--json: emite estructura before/after", async () => {
    await seedPlan("plan-json");
    const { reviewPlan } = await import("../../src/plan/plan-reviewer.js");
    reviewPlan.mockResolvedValueOnce({ ok: true, findings: EMPTY_FINDINGS });
    const { planFixCommand } = await import("../../src/commands/plan/fix.js");
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      await planFixCommand({ config: { projectDir }, planId: "plan-json", logger: { info() {}, warn() {} }, json: true });
    } finally { console.log = origLog; }
    const parsed = JSON.parse(logs[0]);
    expect(parsed.planId).toBe("plan-json");
    expect(parsed.before.hus).toBe(2);
    expect(parsed.after.hus).toBe(2);
  });

  it("persiste el plan actualizado en disco", async () => {
    const { dir } = await seedPlan("plan-persist");
    const { reviewPlan } = await import("../../src/plan/plan-reviewer.js");
    reviewPlan.mockResolvedValueOnce({ ok: true, findings: EMPTY_FINDINGS });
    const { planFixCommand } = await import("../../src/commands/plan/fix.js");
    const origLog = console.log;
    console.log = () => {};
    try {
      await planFixCommand({ config: { projectDir }, planId: "plan-persist", logger: { info() {}, warn() {} }, json: true });
    } finally { console.log = origLog; }
    const persisted = JSON.parse(readFileSync(path.join(dir, "plan-persist.json"), "utf8"));
    expect(persisted.review).toBeTruthy();
    expect(persisted.review.summary).toBe("OK");
  });
});
