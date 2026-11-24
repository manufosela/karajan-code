// HU-4870 (KJC-TSK-1761): kj review --staged runs the diff's own test files before the reviewer;
// a red one ends the review in a rejection without calling the model.
import { describe, expect, it, vi } from "vitest";
import { diffTestFiles, diffTestsGate } from "../../src/review/diff-tests-gate.js";

const vitest = async () => ({ hasTests: true, framework: "vitest", language: "javascript" });
const passing = vi.fn(async () => ({ exitCode: 0, stdout: "2 passed", stderr: "" }));

describe("diffTestFiles (HU-4870)", () => {
  it("keeps only the test files of the diff", () => {
    expect(diffTestFiles(["src/a.js", "tests/a.test.js", "src/b.spec.ts", "docs/x.md", "pkg/test_util.py"]))
      .toEqual(["tests/a.test.js", "src/b.spec.ts", "pkg/test_util.py"]);
  });
});

describe("diffTestsGate (HU-4870)", () => {
  it("runs the diff's test files with the project's runner and lets a green run reach the reviewer", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "2 passed", stderr: "" }));
    const out = await diffTestsGate({ projectDir: "/p", liveFiles: ["src/a.js", "tests/a.test.js"], detect: vitest, run });
    expect(out.rejection).toBeNull();
    expect(run).toHaveBeenCalledWith("npx", ["vitest", "run", "tests/a.test.js"], { cwd: "/p" });
    expect(out.note).toMatch(/1 test file.*passed/);
  });

  it("rejects without the model when a test of the diff fails, naming the file and its error", async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stdout: "FAIL tests/a.test.js > adds\nAssertionError: expected 3 to be 4", stderr: "" }));
    const out = await diffTestsGate({ projectDir: "/p", liveFiles: ["tests/a.test.js"], detect: vitest, run });
    expect(out.rejection).toMatchObject({ verdict: "rejected", reviewer: "diff-tests" });
    const [issue] = out.rejection.issues;
    expect(issue.severity).toBe("high");
    expect(issue.description).toMatch(/tests\/a\.test\.js/);
    expect(issue.description).toMatch(/expected 3 to be 4/);
  });

  it("uses jest and pytest the same way", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    await diffTestsGate({ projectDir: "/p", liveFiles: ["a.test.js"], detect: async () => ({ framework: "jest", language: "javascript" }), run });
    await diffTestsGate({ projectDir: "/p", liveFiles: ["tests/test_a.py"], detect: async () => ({ framework: "pytest", language: "python" }), run });
    expect(run.mock.calls[0]).toEqual(["npx", ["jest", "a.test.js"], { cwd: "/p" }]);
    expect(run.mock.calls[1]).toEqual(["python", ["-m", "pytest", "tests/test_a.py"], { cwd: "/p" }]);
  });

  it("does nothing and says nothing when the diff carries no test file", async () => {
    const out = await diffTestsGate({ projectDir: "/p", liveFiles: ["src/a.js"], detect: vitest, run: passing });
    expect(out).toEqual({ rejection: null, note: null });
  });

  it("goes on as today, saying so in one line, when no runner it knows is detected", async () => {
    const run = vi.fn();
    const out = await diffTestsGate({ projectDir: "/p", liveFiles: ["tests/a_test.go"], detect: async () => ({ framework: "go", language: "go" }), run });
    expect(run).not.toHaveBeenCalled();
    expect(out.rejection).toBeNull();
    expect(out.note).toMatch(/not run/);
    expect(out.note.split("\n")).toHaveLength(1);
  });

  it("keeps the error short: the tail of the output, not all of it", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const run = async () => ({ exitCode: 1, stdout: long, stderr: "" });
    const out = await diffTestsGate({ projectDir: "/p", liveFiles: ["tests/a.test.js"], detect: vitest, run });
    expect(out.rejection.issues[0].description.length).toBeLessThan(4000);
    expect(out.rejection.issues[0].description).toMatch(/line 399/);
  });
});
