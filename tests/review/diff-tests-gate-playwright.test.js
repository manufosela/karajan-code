// HU-5049 (KJC-BUG-0688): in a package with vitest and Playwright, `vitest run <playwright spec>`
// failed and rejected the review. Playwright's files are not run, and never reject.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTestFiles, diffTestsGate } from "../../src/review/diff-tests-gate.js";

let root;
const seed = (rel, text) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const config = (body) => seed("playwright.config.ts", `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n${body}\n});\n`);
const vitest = async () => ({ framework: "vitest", language: "javascript" });
const gate = async (liveFiles) => {
  const run = vi.fn(async () => ({ exitCode: 0, stdout: "passed", stderr: "" }));
  const out = await diffTestsGate({ projectDir: root, liveFiles, detect: vitest, run });
  return { out, ran: run.mock.calls.flatMap(([, args]) => args.slice(2)) };
};

beforeEach(() => {
  // A dot directory in the path, as in a kj lane (.kj/worktrees/...).
  root = mkdtempSync(join(tmpdir(), ".kj-diff-tests-pw-"));
  seed("package.json", JSON.stringify({ devDependencies: { vitest: "1", "@playwright/test": "1" } }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("diffTestsGate with Playwright specs (HU-5049)", () => {
  it("skips the Playwright spec with a note and still runs the vitest test", async () => {
    config(`  testDir: "./test",\n  testMatch: "*.e2e.test.ts",`);
    const { out, ran } = await gate(["test/app.e2e.test.ts", "test/unit.test.ts"]);
    expect(ran).toEqual(["test/unit.test.ts"]);
    expect(out.rejection).toBeNull();
    expect(out.note).toBe("1 test file(s) of the diff passed with vitest; 1 Playwright test file(s) in the diff not run: their own CI runs them");
  });

  it("uses Playwright's default testMatch inside testDir", async () => {
    config(`  // testMatch: "nothing",\n  testDir: 'e2e',`);
    const { ran } = await gate(["e2e/login.spec.ts", "e2e/a/b.test.mjs", "tests/unit.test.ts"]);
    expect(ran).toEqual(["tests/unit.test.ts"]);
  });

  it("reads regex literals and arrays", async () => {
    config(`  testMatch: [/.*\\.pw\\.ts$/, "**/smoke/*.ts"],`);
    const { ran } = await gate(["tests/a.pw.ts", "tests/smoke/b.ts", "tests/c.test.ts"]);
    expect(ran).toEqual(["tests/c.test.ts"]);
  });

  it.each([
    ["a computed testDir", `  testDir: path.join(__dirname, "specs"),`],
    ["one testDir per project", `  projects: [{ testDir: "a" }, { testDir: "b" }],`],
    ["a testMatch only inside a project", `  projects: [{ name: "setup", testMatch: /setup/ }],`],
  ])("with %s, e2e/ and *.e2e.* are Playwright's", async (_label, body) => {
    config(body);
    const { out, ran } = await gate(["e2e/login.spec.ts", "tests/x.e2e.ts", "tests/unit.test.ts"]);
    expect(ran).toEqual(["tests/unit.test.ts"]);
    expect(out.note).toMatch(/2 Playwright test file\(s\)/);
  });

  it("an unreadable config without the Playwright dependency changes nothing", async () => {
    seed("package.json", "{}");
    config(`  testDir: dir,`);
    expect((await gate(["e2e/login.spec.ts"])).ran).toEqual(["e2e/login.spec.ts"]);
  });

  it("a package without a Playwright config runs everything as before", async () => {
    expect((await gate(["e2e/login.spec.ts", "tests/unit.test.ts"])).ran).toHaveLength(2);
  });

  it("counts sources under e2e/ as tests, not other files there", () => {
    expect(diffTestFiles(["e2e/login.ts", "app/e2e/a.js", "e2e/README.md", "src/a.js"])).toEqual(["e2e/login.ts", "app/e2e/a.js"]);
    expect(diffTestFiles(["e2e/request.test.json", "e2e/login.spec.ts"])).toEqual(["e2e/login.spec.ts"]);
  });
});
