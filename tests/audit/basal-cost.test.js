import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { measureBasalCost } from "../../src/audit/basal-cost.js";

// Integration test: build a tiny project on disk and assert what
// findDeadExports flags (vs what it correctly skips). Each scenario covers
// one false-positive class the regex pass historically tripped on.
async function makeProject(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "basal-cost-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return root;
}

async function deadNames(projectDir) {
  const r = await measureBasalCost(projectDir);
  return r.deadExports.map(d => d.name).sort();
}

describe("findDeadExports — false positive avoidance", () => {
  let project;
  afterEach(async () => {
    if (project) await fs.rm(project, { recursive: true, force: true });
  });

  it("ignores exports tagged @internal in JSDoc", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/lib.js": [
        "/**",
        " * @internal Used dynamically by tests.",
        " */",
        "export function helperA() {}",
        "export function helperB() {}",
      ].join("\n"),
    });
    expect(await deadNames(project)).toEqual(["helperB"]);
  });

  it("treats `await import('mod')` as fully consuming mod", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/mod.js": "export function liveOne() {}\nexport function liveTwo() {}",
      "src/consumer.js": "async function load() { return await import('./mod.js'); }",
    });
    expect(await deadNames(project)).toEqual([]);
  });

  it("treats `import * as ns from 'mod'` as fully consuming mod", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/mod.js": "export const A = 1;\nexport const B = 2;",
      "src/consumer.js": "import * as ns from './mod.js';\nconsole.log(ns.A);",
    });
    expect(await deadNames(project)).toEqual([]);
  });

  it("treats `export { x } from 'mod'` as importing x from mod", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/mod.js": "export function reExportedFn() {}\nexport function trulyDeadFn() {}",
      "src/barrel.js": "export { reExportedFn } from './mod.js';",
      "src/consumer.js": "import { reExportedFn } from './barrel.js';\nreExportedFn();",
    });
    expect(await deadNames(project)).toEqual(["trulyDeadFn"]);
  });

  it("treats `export * from 'mod'` as fully consuming mod", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/mod.js": "export const A = 1;\nexport const B = 2;",
      "src/barrel.js": "export * from './mod.js';",
    });
    expect(await deadNames(project)).toEqual([]);
  });

  it("ignores `export ...` patterns inside template literals", async () => {
    project = await makeProject({
      "package.json": "{}",
      "tests/fixture.js": [
        "// pretend this is a test file feeding source-code-as-data to a tool",
        "const sample = `",
        "  export function notRealExport() {}",
        "`;",
        "console.log(sample);",
      ].join("\n"),
    });
    expect(await deadNames(project)).toEqual([]);
  });

  it("ignores `export ...` patterns inside double-quoted strings", async () => {
    project = await makeProject({
      "package.json": "{}",
      "tests/fixture.js": [
        'const diff = "diff --git a/x.js\\n+export function notRealEither() {}";',
        "console.log(diff);",
      ].join("\n"),
    });
    expect(await deadNames(project)).toEqual([]);
  });

  it("still flags genuinely dead exports", async () => {
    project = await makeProject({
      "package.json": "{}",
      "src/lib.js": "export function used() {}\nexport function unused() {}",
      "src/consumer.js": "import { used } from './lib.js';\nused();",
    });
    expect(await deadNames(project)).toEqual(["unused"]);
  });
});
