import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { planShareCommand } from "../../src/commands/plan/share.js";
import { planUnshareCommand } from "../../src/commands/plan/unshare.js";

describe("kj plan unshare — KJC-PRP-0002 PR3", () => {
  let projectDir;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "kjc-plan-unshare-"));
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

  it("removes a shared plan and keeps the per-user copy intact", async () => {
    const { savePlan, loadPlan } = await import("../../src/plan/plan-store.js");
    await savePlan(projectDir, {
      version: 2, planId: "plan-unshare-001", task: "t", hus: [], status: "draft", createdAt: "",
    });

    // First share, then unshare.
    await planShareCommand({ config: { projectDir }, planId: "plan-unshare-001", logger: makeLogger() });
    const sharedPath = path.join(projectDir, ".karajan-shared", "plans", "plan-unshare-001.json");
    await fs.access(sharedPath); // exists

    const logger = makeLogger();
    await planUnshareCommand({ config: { projectDir }, planId: "plan-unshare-001", logger });

    // Shared copy gone, local copy still there.
    await expect(fs.access(sharedPath)).rejects.toThrow();
    const local = await loadPlan(projectDir, "plan-unshare-001");
    expect(local).toBeTruthy();
    expect(local.planId).toBe("plan-unshare-001");
    expect(logger.captured.info.join("\n")).toMatch(/Unshared plan plan-unshare-001/);
  });

  it("exits with code 1 when planId is missing", async () => {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const logger = makeLogger();
    await planUnshareCommand({ config: { projectDir }, planId: "", logger });
    expect(process.exitCode).toBe(1);
    expect(logger.captured.error.join("\n")).toMatch(/planId is required/);
    process.exitCode = prev;
  });

  it("exits with code 1 when the plan is not shared", async () => {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const logger = makeLogger();
    await planUnshareCommand({ config: { projectDir }, planId: "plan-never-shared", logger });
    expect(process.exitCode).toBe(1);
    expect(logger.captured.error.join("\n")).toMatch(/Plan not shared/);
    process.exitCode = prev;
  });
});
