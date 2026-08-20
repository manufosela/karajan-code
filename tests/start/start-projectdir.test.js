// KJC-BUG-0145 (campo, issue #1471 tras la 4.19): `kj start` seguía diciendo
// "new — no source code found" porque startCommand pasaba config.projectDir
// (undefined sin config de proyecto) al sweep; readdir(undefined) reventaba,
// safe() lo tragaba y TODO quedaba a cero. El fix 0141 era correcto y nunca
// llegó a ejecutarse. Dos capas: start resuelve cwd; el sweep falla en alto.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReadOnlySweep } from "../../src/start/sweep.js";
import { startCommand } from "../../src/commands/start.js";

const fakeDecider = (intent = "ASSESS_ONLY") => () => ({
  execute: async () => ({ result: { intent, rationale: "fake", questionToAsk: "" } }),
});
const quiet = { warn: () => {}, info: () => {} };

describe("runReadOnlySweep — projectDir obligatorio (fail-loud, no silent zero)", () => {
  it("rechaza un projectDir ausente en vez de devolver un proyecto vacío", async () => {
    await expect(runReadOnlySweep(undefined)).rejects.toThrow(/projectDir/);
    await expect(runReadOnlySweep("")).rejects.toThrow(/projectDir/);
  });
});

describe("startCommand — resuelve el directorio del proyecto", () => {
  let logSpy;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => logSpy.mockRestore());

  it("sin config.projectDir usa process.cwd() (el caso de Pedro)", async () => {
    const sweep = vi.fn(async () => ({ maturity: { maturity: "new" }, signals: {}, brief: null, tests: null }));
    await startCommand({
      config: {}, logger: quiet, flags: { json: true, yes: true },
      deps: { runReadOnlySweep: sweep, buildAssessment: () => ({ text: "x", summary: { maturity: "new" } }), makeDecider: fakeDecider(), isTTY: () => false },
    });
    expect(sweep).toHaveBeenCalledWith(process.cwd(), expect.anything());
  });

  it("integración en disco: backend/app.js + Dockerfile → el sweep REAL ve código y no dice new", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-demo-kind-"));
    try {
      // Mismo inventario que el demo-kind real: 2 code + 2 infra (> SCAFFOLD_MAX_FILES).
      fs.mkdirSync(path.join(dir, "backend"));
      fs.mkdirSync(path.join(dir, "frontend"));
      fs.writeFileSync(path.join(dir, "backend", "app.js"), "console.log(1)\n");
      fs.writeFileSync(path.join(dir, "backend", "app.test.js"), "test\n");
      fs.writeFileSync(path.join(dir, "backend", "eslint.config.js"), "module.exports = {}\n");
      fs.writeFileSync(path.join(dir, "backend", "Dockerfile"), "FROM node\n");
      fs.writeFileSync(path.join(dir, "frontend", "Dockerfile"), "FROM nginx\n");
      fs.writeFileSync(path.join(dir, "frontend", "index.html"), "<html></html>\n");
      await startCommand({
        config: { projectDir: dir }, logger: quiet, flags: { json: true, yes: true },
        deps: { makeDecider: fakeDecider(), isTTY: () => false },
      });
      const out = JSON.parse(logSpy.mock.calls.at(-1)[0]);
      expect(out.maturity).not.toBe("new");
      expect(out.assessment).not.toMatch(/no source code found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
