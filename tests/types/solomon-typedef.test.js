/**
 * TSK-0326 — smoke test for src/types/solomon.js + the Brain⇄Solomon invariant.
 *
 * The typedef module is runtime-empty (it only carries JSDoc). The test
 * guarantees:
 *   1. The module is loadable (no syntax errors in the JSDoc comments).
 *   2. src/orchestrator/solomon-escalation.js and src/brain/solomon-consult.js
 *      reference the typedef via JSDoc `import("../types/solomon.js")`.
 *   3. src/orchestrator/solomon-escalation.js carries the architectural
 *      invariant note ("only Brain / the orchestrator may call invokeSolomon").
 *   4. docs/ARCHITECTURE.md (EN + ES) mentions the same invariant so the rule
 *      is visible outside the source file.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// regression-for: TSK-0326
describe("src/types/solomon.js — Conflict typedef registry (TSK-0326)", () => {
  it("module loads without side effects", async () => {
    const mod = await import("../../src/types/solomon.js");
    // Runtime-empty: the only export is the default `export {}` sentinel.
    expect(Object.keys(mod)).toEqual([]);
  });

  it("defines @typedef Conflict with the documented fields", async () => {
    const src = await fs.readFile(path.join(ROOT, "src/types/solomon.js"), "utf8");
    expect(src).toContain("@typedef {Object} Conflict");
    for (const field of [
      "stage",
      "task",
      "iterationCount",
      "maxIterations",
      "cooldownUntil",
      "cooldownMs",
      "history",
    ]) {
      expect(src).toContain(`@property`);
      expect(src).toContain(field);
    }
  });

  it("defines ConflictHistoryEntry and SolomonResult typedefs", async () => {
    const src = await fs.readFile(path.join(ROOT, "src/types/solomon.js"), "utf8");
    expect(src).toContain("@typedef {Object} ConflictHistoryEntry");
    expect(src).toContain("@typedef {Object} SolomonResult");
  });

  it("is re-exported from src/types/index.js", async () => {
    const src = await fs.readFile(path.join(ROOT, "src/types/index.js"), "utf8");
    expect(src).toMatch(/import\("\.\/solomon\.js"\)\.Conflict/);
    expect(src).toMatch(/import\("\.\/solomon\.js"\)\.SolomonResult/);
  });
});

describe("Brain⇄Solomon invariant is documented where it matters", () => {
  it("solomon-escalation.js uses the Conflict typedef via JSDoc import", async () => {
    const src = await fs.readFile(
      path.join(ROOT, "src/orchestrator/solomon-escalation.js"),
      "utf8"
    );
    expect(src).toMatch(/import\("\.\.\/types\/solomon\.js"\)\.Conflict/);
  });

  it("solomon-escalation.js carries the 'only Brain may invoke' note", async () => {
    const src = await fs.readFile(
      path.join(ROOT, "src/orchestrator/solomon-escalation.js"),
      "utf8"
    );
    expect(src).toMatch(/MUST NOT be called directly from stages/i);
    expect(src).toMatch(/Brain-as-gateway|on behalf of Brain/);
  });

  it("solomon-consult.js imports the Conflict + SolomonResult typedefs", async () => {
    const src = await fs.readFile(
      path.join(ROOT, "src/brain/solomon-consult.js"),
      "utf8"
    );
    expect(src).toMatch(/import\("\.\.\/types\/solomon\.js"\)\.Conflict/);
    expect(src).toMatch(/import\("\.\.\/types\/solomon\.js"\)\.SolomonResult/);
  });

  it("ARCHITECTURE.md (EN) documents the invariant", async () => {
    const src = await fs.readFile(path.join(ROOT, "docs/ARCHITECTURE.md"), "utf8");
    expect(src).toMatch(/never from stages or rules/i);
    expect(src).toMatch(/21 violations/);
  });

  it("ARCHITECTURE.md (ES) documents the invariant", async () => {
    const src = await fs.readFile(path.join(ROOT, "docs/es/ARCHITECTURE.md"), "utf8");
    expect(src).toMatch(/NUNCA desde stages/);
    expect(src).toMatch(/21 violaciones/);
  });
});
