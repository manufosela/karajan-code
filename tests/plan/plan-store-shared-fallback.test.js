import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// loadPlan falls back to <projectDir>/.karajan-shared/plans/ when the
// plan is not found in the per-user `~/.karajan/plans/<slug>/`.
// KJC-PRP-0002 PR1.

describe("plan-store loadPlan — shared-dir fallback (KJC-PRP-0002 PR1)", () => {
  let projectDir;
  const originalKjHome = process.env.KJ_HOME;
  const originalKarajanHome = process.env.KARAJAN_HOME;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "kjc-shared-fallback-"));
  });

  afterEach(async () => {
    if (originalKjHome !== undefined) process.env.KJ_HOME = originalKjHome;
    else delete process.env.KJ_HOME;
    if (originalKarajanHome !== undefined) process.env.KARAJAN_HOME = originalKarajanHome;
    else delete process.env.KARAJAN_HOME;
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it("loads from .karajan-shared/plans when the local dir has no copy", async () => {
    const { loadPlan } = await import("../../src/plan/plan-store.js");
    const sharedDir = path.join(projectDir, ".karajan-shared", "plans");
    await fs.mkdir(sharedDir, { recursive: true });
    const plan = {
      version: 2,
      planId: "plan-team-shared-001",
      task: "shared fixture",
      hus: [],
      status: "draft",
      createdAt: "2026-05-26T00:00:00Z",
    };
    await fs.writeFile(path.join(sharedDir, "plan-team-shared-001.json"), JSON.stringify(plan));

    const loaded = await loadPlan(projectDir, "plan-team-shared-001");
    expect(loaded).not.toBeNull();
    expect(loaded.planId).toBe("plan-team-shared-001");
    expect(loaded.task).toBe("shared fixture");
  });

  it("local plan wins over the shared copy when both exist", async () => {
    const { savePlan, loadPlan } = await import("../../src/plan/plan-store.js");
    await savePlan(projectDir, {
      version: 2,
      planId: "plan-collision-001",
      task: "local wins",
      hus: [],
      status: "draft",
      createdAt: "2026-05-26T00:00:00Z",
    });

    const sharedDir = path.join(projectDir, ".karajan-shared", "plans");
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(
      path.join(sharedDir, "plan-collision-001.json"),
      JSON.stringify({
        version: 2,
        planId: "plan-collision-001",
        task: "shared loses",
        hus: [],
        status: "draft",
        createdAt: "2026-05-26T00:00:00Z",
      })
    );

    const loaded = await loadPlan(projectDir, "plan-collision-001");
    expect(loaded.task).toBe("local wins");
  });

  it("resolves shared plans by alias too", async () => {
    const { loadPlan } = await import("../../src/plan/plan-store.js");
    const sharedDir = path.join(projectDir, ".karajan-shared", "plans");
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(
      path.join(sharedDir, "plan-aliased-001.json"),
      JSON.stringify({
        version: 2,
        planId: "plan-aliased-001",
        alias: "auth-rework",
        task: "by alias",
        hus: [],
        status: "draft",
        createdAt: "2026-05-26T00:00:00Z",
      })
    );

    const loaded = await loadPlan(projectDir, "auth-rework");
    expect(loaded).not.toBeNull();
    expect(loaded.planId).toBe("plan-aliased-001");
  });

  it("returns null when neither local nor shared has the plan", async () => {
    const { loadPlan } = await import("../../src/plan/plan-store.js");
    const loaded = await loadPlan(projectDir, "plan-does-not-exist");
    expect(loaded).toBeNull();
  });
});
