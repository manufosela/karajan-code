import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { planReadyCommand } from "../src/commands/plan.js";
import { createPlanV2 } from "../src/plan/plan-schema.js";
import { addHu } from "../src/plan/plan-hu-ops.js";
import { savePlan } from "../src/plan/plan-store.js";

// Tests-first gate (v2.7.5): `kj plan ready <planId>` refuses to mark
// a plan as ready unless every HU has at least one acceptance_test.
// Without this, the coder would get handed HUs with no contract and
// we'd be back to "pipeline guesses what passes".

let tmpKjHome;
let savedKjHome;
let savedExitCode;
let projectDir;
let consoleErrorSpy;

beforeEach(async () => {
  tmpKjHome = await fs.mkdtemp(path.join(os.tmpdir(), "plan-ready-gate-"));
  savedKjHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmpKjHome;
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-"));
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleErrorSpy.mockRestore();
  process.exitCode = savedExitCode;
  if (savedKjHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedKjHome;
  await fs.rm(tmpKjHome, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

async function writePlan(hus) {
  const plan = createPlanV2("a task");
  for (const hu of hus) addHu(plan, hu);
  const planId = await savePlan(projectDir, plan);
  return planId;
}

describe("planReadyCommand — tests-first gate", () => {
  it("refuses to mark ready when a HU has no acceptance_tests", async () => {
    const planId = await writePlan([
      {
        title: "with tests",
        scope: "ok",
        acceptance_tests: [{ type: "shell", content: "echo ok" }],
      },
      {
        title: "without tests",
        scope: "uh oh",
        acceptance_tests: [],
      },
    ]);

    await planReadyCommand({ config: { projectDir }, planId });

    expect(process.exitCode).toBe(1);
    const stderr = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toContain("1/2 HU(s) have no acceptance_tests");
    expect(stderr).toContain("without tests");
  });

  it("allows marking ready when every HU has at least one test", async () => {
    const planId = await writePlan([
      { title: "a", scope: "s", acceptance_tests: [{ type: "shell", content: "echo a" }] },
      { title: "b", scope: "s", acceptance_tests: [{ type: "gherkin", content: "Given x\nWhen y\nThen z" }] },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planReadyCommand({ config: { projectDir }, planId });
    expect(process.exitCode).toBe(0);
    const stdout = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stdout).toContain("HUs certified");
    logSpy.mockRestore();
  });

  it("refuses when HU has acceptance_tests: undefined (legacy pre-v2.7.5 plans)", async () => {
    const plan = createPlanV2("legacy");
    plan.hus.push({
      id: "plan-legacy_001",
      title: "from old planner",
      status: "pending",
      blocked_by: [],
      // no acceptance_tests at all
    });
    const planId = await savePlan(projectDir, plan);

    await planReadyCommand({ config: { projectDir }, planId });

    expect(process.exitCode).toBe(1);
    const stderr = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toContain("no acceptance_tests");
  });
});
