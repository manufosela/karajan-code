// HU-4918 (KJC-BUG-0670), field case from kj-stage: in a monorepo the root vitest config
// excludes packages/**, so `npx vitest run packages/hu-board/tests/x.test.js` from the root found
// no test files, exited 1 and rejected a diff whose tests were green in their own package.
// Each test file now runs from its own package (the nearest package.json or pyproject.toml).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTestsGate } from "../../src/review/diff-tests-gate.js";

let root;
const seed = (rel, text = "{}") => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const vitest = async () => ({ hasTests: true, framework: "vitest", language: "javascript" });
const green = () => vi.fn(async () => ({ exitCode: 0, stdout: "passed", stderr: "" }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-diff-tests-pkg-"));
  seed("package.json");
  seed("packages/hu-board/package.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("diffTestsGate in a monorepo (HU-4918)", () => {
  it("runs a package's test from that package, with the path relative to it", async () => {
    const run = green();
    const out = await diffTestsGate({ projectDir: root, liveFiles: ["packages/hu-board/tests/stage.test.js"], detect: vitest, run });
    expect(run).toHaveBeenCalledWith("npx", ["vitest", "run", "tests/stage.test.js"], { cwd: join(root, "packages/hu-board") });
    expect(out.rejection).toBeNull();
  });

  it("runs the root tests and each package's tests apart, and counts them all", async () => {
    const run = green();
    const out = await diffTestsGate({
      projectDir: root,
      liveFiles: ["tests/a.test.js", "packages/hu-board/tests/b.test.js", "packages/hu-board/tests/c.test.js"],
      detect: vitest,
      run,
    });
    expect(run).toHaveBeenCalledWith("npx", ["vitest", "run", "tests/a.test.js"], { cwd: root });
    expect(run).toHaveBeenCalledWith("npx", ["vitest", "run", "tests/b.test.js", "tests/c.test.js"], { cwd: join(root, "packages/hu-board") });
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.note).toMatch(/3 test file\(s\) of the diff passed/);
  });

  it("detects the runner in the package itself", async () => {
    const detect = vi.fn(vitest);
    await diffTestsGate({ projectDir: root, liveFiles: ["packages/hu-board/tests/b.test.js"], detect, run: green() });
    expect(detect).toHaveBeenCalledWith(join(root, "packages/hu-board"));
  });

  it("a package with no runner of its own uses the root's", async () => {
    const detect = vi.fn(async (dir) => (dir === root ? vitest() : null));
    const run = green();
    await diffTestsGate({ projectDir: root, liveFiles: ["packages/hu-board/tests/b.test.js"], detect, run });
    expect(run).toHaveBeenCalledWith("npx", ["vitest", "run", "tests/b.test.js"], { cwd: join(root, "packages/hu-board") });
  });

  it("a red package rejects, naming its files with the repo path", async () => {
    const run = vi.fn(async (_cmd, _args, { cwd }) => (cwd === root
      ? { exitCode: 0, stdout: "passed", stderr: "" }
      : { exitCode: 1, stdout: "AssertionError: expected 1 to be 2", stderr: "" }));
    const out = await diffTestsGate({ projectDir: root, liveFiles: ["tests/a.test.js", "packages/hu-board/tests/b.test.js"], detect: vitest, run });
    expect(out.rejection).toMatchObject({ verdict: "rejected", reviewer: "diff-tests" });
    const [issue] = out.rejection.issues;
    expect(issue.description).toMatch(/packages\/hu-board\/tests\/b\.test\.js/);
    expect(issue.description).not.toMatch(/tests\/a\.test\.js/);
    expect(issue.description).toMatch(/expected 1 to be 2/);
  });

  it("a python test runs from its nearest pyproject.toml", async () => {
    seed("services/api/pyproject.toml", "[project]\nname = 'api'\n");
    const run = green();
    await diffTestsGate({ projectDir: root, liveFiles: ["services/api/tests/test_x.py"], detect: async () => ({ framework: "pytest", language: "python" }), run });
    expect(run).toHaveBeenCalledWith("python", ["-m", "pytest", "tests/test_x.py"], { cwd: join(root, "services/api") });
  });
});
