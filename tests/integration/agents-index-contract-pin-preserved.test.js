// kept-because: external-contract
//
// Translates the Gherkin acceptance scenario for the diet pass on
// `tests/integration/*` into an executable check. Guards against future
// passes deleting `agents-index-contract.test.js` or stripping its
// `// kept-because: external-contract` annotation just because the same
// code paths are covered by unit tests under `tests/agents-index.test.js`
// and `tests/agents/create-agent.test.js`.
//
// regression-for: tests/integration diet-pass acceptance
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contractTestPath = resolve(here, "agents-index-contract.test.js");

describe("tests/integration diet pass — external-contract pin preservation", () => {
  it("keeps the integration contract test for src/agents/index.js on disk", () => {
    expect(existsSync(contractTestPath)).toBe(true);
  });

  it("keeps the // kept-because: external-contract annotation on the contract test", () => {
    const file = readFileSync(contractTestPath, "utf8");
    expect(file).toMatch(/\/\/\s*kept-because:\s*external-contract/);
  });

  it("contract test still imports the public surface from src/agents/index.js", () => {
    const file = readFileSync(contractTestPath, "utf8");
    expect(file).toMatch(/from\s+["']\.\.\/\.\.\/src\/agents\/index\.js["']/);
    expect(file).toMatch(/createAgent/);
  });
});
