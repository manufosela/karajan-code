import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { planShareCommand } from "../../src/commands/plan/share.js";

describe("kj plan share — KJC-PRP-0002 PR1", () => {
  let projectDir;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "kjc-plan-share-"));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  function makeLogger() {
    const captured = { info: [], error: [] };
    return {
      info: (m) => captured.info.push(m),
      error: (m) => captured.error.push(m),
      captured,
    };
  }

  it("promotes a local plan to <projectDir>/.karajan-shared/plans/", async () => {
    const { savePlan } = await import("../../src/plan/plan-store.js");
    await savePlan(projectDir, {
      version: 2,
      planId: "plan-share-001",
      task: "shareable",
      hus: [],
      status: "draft",
      createdAt: "2026-05-26T00:00:00Z",
    });

    const logger = makeLogger();
    await planShareCommand({ config: { projectDir }, planId: "plan-share-001", logger });

    const target = path.join(projectDir, ".karajan-shared", "plans", "plan-share-001.json");
    const written = JSON.parse(await fs.readFile(target, "utf8"));
    expect(written.planId).toBe("plan-share-001");
    expect(written.shared).toBe(true);
    expect(written.sharedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(logger.captured.info.join("\n")).toMatch(/Shared plan plan-share-001/);
  });

  it("exits with code 1 when planId is missing", async () => {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const logger = makeLogger();
    await planShareCommand({ config: { projectDir }, planId: "", logger });
    expect(process.exitCode).toBe(1);
    expect(logger.captured.error.join("\n")).toMatch(/planId is required/);
    process.exitCode = prev;
  });

  it("exits with code 1 when the plan is not found", async () => {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const logger = makeLogger();
    await planShareCommand({ config: { projectDir }, planId: "plan-missing-999", logger });
    expect(process.exitCode).toBe(1);
    expect(logger.captured.error.join("\n")).toMatch(/Plan not found: plan-missing-999/);
    process.exitCode = prev;
  });

  // KJC-PRP-0002 PR4: per-HU filter — --only / --exclude.
  describe("per-HU filter (--only / --exclude)", () => {
    async function seedThreeHuPlan() {
      const { savePlan } = await import("../../src/plan/plan-store.js");
      await savePlan(projectDir, {
        version: 2,
        planId: "plan-filter-001",
        task: "filtered share",
        hus: [
          { id: "HU-1", status: "pending", title: "A" },
          { id: "HU-2", status: "pending", title: "B" },
          { id: "HU-3", status: "pending", title: "C" },
        ],
        status: "draft",
        createdAt: "",
      });
    }

    it("with --only, shares only the listed HUs and records the filter", async () => {
      await seedThreeHuPlan();
      await planShareCommand({
        config: { projectDir },
        planId: "plan-filter-001",
        logger: makeLogger(),
        only: "HU-1,HU-3",
      });
      const target = path.join(projectDir, ".karajan-shared", "plans", "plan-filter-001.json");
      const written = JSON.parse(await fs.readFile(target, "utf8"));
      expect(written.hus.map((h) => h.id)).toEqual(["HU-1", "HU-3"]);
      expect(written.sharedFilter).toEqual({ only: ["HU-1", "HU-3"] });
    });

    it("with --exclude, shares all HUs except the listed ones", async () => {
      await seedThreeHuPlan();
      await planShareCommand({
        config: { projectDir },
        planId: "plan-filter-001",
        logger: makeLogger(),
        exclude: "HU-2",
      });
      const target = path.join(projectDir, ".karajan-shared", "plans", "plan-filter-001.json");
      const written = JSON.parse(await fs.readFile(target, "utf8"));
      expect(written.hus.map((h) => h.id)).toEqual(["HU-1", "HU-3"]);
      expect(written.sharedFilter).toEqual({ exclude: ["HU-2"] });
    });

    it("rejects --only + --exclude together", async () => {
      await seedThreeHuPlan();
      const prev = process.exitCode;
      process.exitCode = undefined;
      const logger = makeLogger();
      await planShareCommand({
        config: { projectDir },
        planId: "plan-filter-001",
        logger,
        only: "HU-1",
        exclude: "HU-2",
      });
      expect(process.exitCode).toBe(1);
      expect(logger.captured.error.join("\n")).toMatch(/mutually exclusive/);
      process.exitCode = prev;
    });

    it("exits with code 1 when the filter removes every HU", async () => {
      await seedThreeHuPlan();
      const prev = process.exitCode;
      process.exitCode = undefined;
      const logger = makeLogger();
      await planShareCommand({
        config: { projectDir },
        planId: "plan-filter-001",
        logger,
        only: "HU-nope",
      });
      expect(process.exitCode).toBe(1);
      expect(logger.captured.error.join("\n")).toMatch(/No HUs left/);
      process.exitCode = prev;
    });

    it("leaves the per-user copy untouched (only filters the shared copy)", async () => {
      await seedThreeHuPlan();
      await planShareCommand({
        config: { projectDir },
        planId: "plan-filter-001",
        logger: makeLogger(),
        only: "HU-1",
      });
      const { loadPlan } = await import("../../src/plan/plan-store.js");
      const local = await loadPlan(projectDir, "plan-filter-001");
      expect(local.hus.map((h) => h.id)).toEqual(["HU-1", "HU-2", "HU-3"]);
    });
  });

  it("is idempotent — sharing twice rewrites the file without error", async () => {
    const { savePlan } = await import("../../src/plan/plan-store.js");
    await savePlan(projectDir, {
      version: 2,
      planId: "plan-share-idem-001",
      task: "twice",
      hus: [],
      status: "draft",
      createdAt: "2026-05-26T00:00:00Z",
    });

    await planShareCommand({ config: { projectDir }, planId: "plan-share-idem-001", logger: makeLogger() });
    const target = path.join(projectDir, ".karajan-shared", "plans", "plan-share-idem-001.json");
    const firstStamp = JSON.parse(await fs.readFile(target, "utf8")).sharedAt;

    await new Promise((r) => setTimeout(r, 5));
    await planShareCommand({ config: { projectDir }, planId: "plan-share-idem-001", logger: makeLogger() });
    const secondStamp = JSON.parse(await fs.readFile(target, "utf8")).sharedAt;

    expect(secondStamp >= firstStamp).toBe(true);
  });
});
