import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerRun,
  unregisterRun,
  listActiveRuns,
  runsDir,
} from "../src/run-registry.js";

describe("@karajan/core/run-registry", () => {
  let tmpHome;
  let originalKarajanHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kj-runreg-"));
    originalKarajanHome = process.env.KARAJAN_HOME;
    process.env.KARAJAN_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalKarajanHome === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = originalKarajanHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("runsDir hangs off KARAJAN_HOME/runs", () => {
    expect(runsDir()).toBe(path.join(path.resolve(tmpHome), "runs"));
  });

  it("registerRun → listActiveRuns round-trips for the live process", () => {
    const runId = registerRun({
      pid: process.pid,
      planId: "PLN-1",
      huIds: ["HU-1"],
      projectDir: "/tmp/x",
      source: "test",
    });
    expect(runId).toMatch(/^run-\d+-\d+-[a-z0-9]+$/);
    const list = listActiveRuns({ planId: "PLN-1" });
    expect(list.length).toBe(1);
    expect(list[0].pid).toBe(process.pid);
    unregisterRun(runId);
    expect(listActiveRuns({ planId: "PLN-1" })).toEqual([]);
  });

  it("listActiveRuns reaps entries with dead PIDs from disk", () => {
    fs.mkdirSync(runsDir(), { recursive: true });
    const deadEntry = {
      runId: "run-dead",
      pid: 999_999_999,
      planId: "PLN-x",
      huIds: null,
      projectDir: null,
      source: "test",
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(runsDir(), "run-dead.json"),
      JSON.stringify(deadEntry),
    );
    expect(listActiveRuns()).toEqual([]);
    expect(fs.existsSync(path.join(runsDir(), "run-dead.json"))).toBe(false);
  });

  it("registerRun returns null when pid is missing", () => {
    expect(registerRun({})).toBeNull();
    expect(registerRun({ pid: 0 })).toBeNull();
  });
});
