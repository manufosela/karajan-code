// KJC-TSK-0396 (extensión): tests del registry FS de runs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerRun, unregisterRun, listActiveRuns, runsDir } from "../../src/utils/run-registry.js";

let tmpHome;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-run-registry-"));
  process.env.KJ_HOME = tmpHome;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe("run-registry", () => {
  it("registerRun escribe un JSON con el shape esperado", () => {
    const runId = registerRun({
      pid: process.pid,
      planId: "plan-X",
      huIds: ["hu_1", "hu_2"],
      projectDir: "/tmp/foo",
      source: "cli",
    });
    expect(runId).toMatch(/^run-\d+-\d+-[a-z0-9]+$/);
    const files = readdirSync(runsDir());
    expect(files).toContain(`${runId}.json`);
  });

  it("unregisterRun elimina el JSON (idempotente)", () => {
    const runId = registerRun({ pid: process.pid, planId: "p" });
    unregisterRun(runId);
    expect(existsSync(join(runsDir(), `${runId}.json`))).toBe(false);
    // Llamar otra vez no rompe.
    unregisterRun(runId);
  });

  it("listActiveRuns filtra PIDs muertos y los borra del disco", () => {
    registerRun({ pid: process.pid, planId: "alive" });
    registerRun({ pid: 99999999, planId: "dead" });
    const active = listActiveRuns();
    expect(active.map((r) => r.planId).sort()).toEqual(["alive"]);
    // El dead se ha borrado del disco.
    const remaining = readdirSync(runsDir());
    expect(remaining).toHaveLength(1);
  });

  it("listActiveRuns filtra por planId cuando se pasa", () => {
    registerRun({ pid: process.pid, planId: "plan-A" });
    registerRun({ pid: process.pid, planId: "plan-B" });
    expect(listActiveRuns({ planId: "plan-A" })).toHaveLength(1);
    expect(listActiveRuns({ planId: "plan-A" })[0].planId).toBe("plan-A");
  });

  it("listActiveRuns devuelve [] si el dir no existe", () => {
    // No registramos nada → dir no existe.
    expect(listActiveRuns()).toEqual([]);
  });

  it("registerRun sin pid devuelve null sin escribir nada", () => {
    expect(registerRun({})).toBeNull();
    expect(existsSync(runsDir())).toBe(false);
  });

  it("listActiveRuns descarta archivos JSON corruptos y los borra", () => {
    const runId = registerRun({ pid: process.pid, planId: "p" });
    // Corrompemos otro archivo (manual fs write con contenido inválido).
    const fs = require("node:fs");
    fs.writeFileSync(join(runsDir(), "bad.json"), "{not valid json");
    const active = listActiveRuns();
    expect(active.map((r) => r.runId)).toEqual([runId]);
    // bad.json se borró
    expect(existsSync(join(runsDir(), "bad.json"))).toBe(false);
  });
});
