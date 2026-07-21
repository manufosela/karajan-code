// KJC-TSK-0647: running the FULL suite on every push is redundant when CI
// already runs it per PR, and a source of false reds (suites unstable under
// local parallelism — reproduced in the field). When a CI workflow runs
// tests, harden drops the test command from pre-push unless the repo opts
// back in via package.json `kj.harden.test_on_push: true`.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ciRunsTests, resolveTestOnPush } from "../../src/harden/test-on-push.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-top-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function writeWorkflow(content) {
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "workflows", "ci.yml"), content);
}

describe("ciRunsTests", () => {
  it("true when a workflow runs a test command", () => {
    writeWorkflow("jobs:\n  test:\n    steps:\n      - run: npm test\n");
    expect(ciRunsTests(dir)).toBe(true);
  });

  it("false without workflows or without test steps", () => {
    expect(ciRunsTests(dir)).toBe(false);
    writeWorkflow("jobs:\n  lint:\n    steps:\n      - run: npm run lint\n");
    expect(ciRunsTests(dir)).toBe(false);
  });
});

describe("resolveTestOnPush", () => {
  it("CI runs tests → pre-push drops the test command (with reason)", () => {
    writeWorkflow("jobs:\n  t:\n    steps:\n      - run: vitest run\n");
    const res = resolveTestOnPush({ projectDir: dir, repoCfg: {}, testCmd: "npm test" });
    expect(res.testCmd).toBeNull();
    expect(res.reason).toMatch(/CI/);
  });

  it("explicit opt-in keeps tests on push even with CI", () => {
    writeWorkflow("jobs:\n  t:\n    steps:\n      - run: vitest run\n");
    const res = resolveTestOnPush({ projectDir: dir, repoCfg: { test_on_push: true }, testCmd: "npm test" });
    expect(res.testCmd).toBe("npm test");
  });

  it("no CI → tests stay on push (last safety net)", () => {
    const res = resolveTestOnPush({ projectDir: dir, repoCfg: {}, testCmd: "npm test" });
    expect(res.testCmd).toBe("npm test");
  });
});
