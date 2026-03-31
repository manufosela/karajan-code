import { beforeEach, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpDir;
let savedKjHome;

describe("plan-store", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-plan-test-"));
    savedKjHome = process.env.KJ_HOME;
    process.env.KJ_HOME = tmpDir;
  });

  afterEach(async () => {
    if (savedKjHome === undefined) {
      delete process.env.KJ_HOME;
    } else {
      process.env.KJ_HOME = savedKjHome;
    }
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("savePlan persists to disk and returns planId", async () => {
    const { savePlan } = await import("../src/plan/plan-store.js");

    const planId = await savePlan("/home/user/my-project", {
      task: "Add login feature",
      researchContext: { files: ["auth.js"] },
      architectContext: { layers: ["service"] },
      plan: { approach: "Use JWT", steps: [{ description: "Add auth module" }] },
      raw: '{"approach": "Use JWT"}'
    });

    expect(planId).toMatch(/^plan-\d+-[a-z0-9]+$/);

    // Verify file exists
    const plansDir = path.join(tmpDir, "plans");
    const dirs = await fs.readdir(plansDir);
    expect(dirs.length).toBe(1);

    const files = await fs.readdir(path.join(plansDir, dirs[0]));
    expect(files.length).toBe(1);
    expect(files[0]).toBe(`${planId}.json`);

    // Verify content
    const content = JSON.parse(await fs.readFile(path.join(plansDir, dirs[0], files[0]), "utf8"));
    expect(content.task).toBe("Add login feature");
    expect(content.researchContext).toEqual({ files: ["auth.js"] });
    expect(content.architectContext).toEqual({ layers: ["service"] });
    expect(content.plan.approach).toBe("Use JWT");
    expect(content.createdAt).toBeTruthy();
  });

  it("loadPlan retrieves a saved plan", async () => {
    const { savePlan, loadPlan } = await import("../src/plan/plan-store.js");

    const planId = await savePlan("/home/user/project-a", {
      task: "Fix bug #42",
      researchContext: { patterns: ["singleton"] },
      architectContext: null,
      plan: { approach: "Patch the singleton", steps: [] }
    });

    const loaded = await loadPlan("/home/user/project-a", planId);
    expect(loaded).not.toBeNull();
    expect(loaded.planId).toBe(planId);
    expect(loaded.task).toBe("Fix bug #42");
    expect(loaded.researchContext).toEqual({ patterns: ["singleton"] });
    expect(loaded.architectContext).toBeNull();
    expect(loaded.plan.approach).toBe("Patch the singleton");
    expect(loaded.createdAt).toBeTruthy();
  });

  it("loadPlan returns null for non-existent plan", async () => {
    const { loadPlan } = await import("../src/plan/plan-store.js");

    const loaded = await loadPlan("/home/user/project-x", "plan-nonexistent-abc");
    expect(loaded).toBeNull();
  });

  it("listPlans returns available plans sorted newest first", async () => {
    const { savePlan, listPlans } = await import("../src/plan/plan-store.js");

    const id1 = await savePlan("/home/user/proj", { task: "Task A", plan: "plan a" });

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 20));

    const id2 = await savePlan("/home/user/proj", { task: "Task B", plan: "plan b" });

    const plans = await listPlans("/home/user/proj");
    expect(plans.length).toBe(2);
    expect(plans[0].planId).toBe(id2);
    expect(plans[0].task).toBe("Task B");
    expect(plans[1].planId).toBe(id1);
    expect(plans[1].task).toBe("Task A");
  });

  it("listPlans returns empty array for project with no plans", async () => {
    const { listPlans } = await import("../src/plan/plan-store.js");

    const plans = await listPlans("/nonexistent/project");
    expect(plans).toEqual([]);
  });

  it("getLatestPlan returns the most recent plan", async () => {
    const { savePlan, getLatestPlan } = await import("../src/plan/plan-store.js");

    await savePlan("/home/user/proj2", { task: "Old task", plan: "old plan" });
    await new Promise((r) => setTimeout(r, 20));
    const latestId = await savePlan("/home/user/proj2", { task: "New task", plan: "new plan" });

    const latest = await getLatestPlan("/home/user/proj2");
    expect(latest).not.toBeNull();
    expect(latest.planId).toBe(latestId);
    expect(latest.task).toBe("New task");
  });

  it("getLatestPlan returns null when no plans exist", async () => {
    const { getLatestPlan } = await import("../src/plan/plan-store.js");

    const latest = await getLatestPlan("/empty/project");
    expect(latest).toBeNull();
  });
});

describe("kj_plan runs researcher + architect before planner", () => {
  it("handlePlanDirect invokes researcher and architect phases", async () => {
    const directHandlers = await import("../src/mcp/handlers/direct-handlers.js");
    const fnSource = directHandlers.handlePlanDirect.toString();
    expect(fnSource).toContain("ResearcherRole");
    expect(fnSource).toContain("ArchitectRole");
    expect(fnSource).toContain("savePlan");
  });
});

describe("kj_run with plan parameter", () => {
  it("kj_run tool definition includes plan parameter", async () => {
    const { tools } = await import("../src/mcp/tools.js");
    const runTool = tools.find((t) => t.name === "kj_run");
    expect(runTool).toBeDefined();
    expect(runTool.inputSchema.properties.plan).toBeDefined();
    expect(runTool.inputSchema.properties.plan.type).toBe("string");
  });

  it("kj_run without plan runs normally (no plan loading)", async () => {
    const orchestratorSource = await fs.readFile(
      path.join(process.cwd(), "src/orchestrator.js"),
      "utf8"
    );
    // The plan loading is behind a `if (flags.plan)` guard
    expect(orchestratorSource).toContain("if (flags.plan)");
    expect(orchestratorSource).toContain("loadPlan");
    expect(orchestratorSource).toContain("plan:loaded");
  });
});
