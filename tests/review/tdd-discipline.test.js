import { describe, expect, it, vi } from "vitest";
import { verifyTddDiscipline } from "../../src/review/tdd-discipline.js";

function makeDeps({ outputs = ["", ""], stashToken = "STASH-1" } = {}) {
  return {
    runTests: vi.fn(async () => ({ exitCode: 0, output: outputs.shift() ?? "" })),
    stashFiles: vi.fn(async () => stashToken),
    restoreFiles: vi.fn(async () => true),
  };
}

describe("verifyTddDiscipline", () => {
  it("skips when there are no source changes", async () => {
    const deps = makeDeps();
    const out = await verifyTddDiscipline({
      sourceFiles: [], testFiles: ["tests/x.test.js"], framework: "vitest", ...deps,
    });
    expect(out).toMatchObject({ ok: true, reason: "no_source_changes" });
    expect(deps.runTests).not.toHaveBeenCalled();
  });

  it("skips when there are no test changes", async () => {
    const deps = makeDeps();
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/x.js"], testFiles: [], framework: "vitest", ...deps,
    });
    expect(out).toMatchObject({ ok: true, reason: "no_test_changes" });
    expect(deps.stashFiles).not.toHaveBeenCalled();
  });

  it("skips with warning when the framework has no parser", async () => {
    const deps = makeDeps();
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/x.js"], testFiles: ["tests/x.test.js"], framework: "rspec", ...deps,
    });
    expect(out.ok).toBe(true);
    expect(out.reason).toBe("framework_unsupported");
    expect(out.warning).toMatch(/rspec/);
  });

  it("fails when new tests pass without the implementation", async () => {
    const deps = makeDeps({ outputs: ["", ""] });
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], framework: "vitest", ...deps,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("tests_pass_without_impl");
    expect(deps.restoreFiles).toHaveBeenCalledTimes(1);
    expect(deps.runTests).toHaveBeenCalledTimes(1);
  });

  it("passes on the red-then-green happy path", async () => {
    const deps = makeDeps({
      outputs: [" FAIL  tests/auth.test.js\n", " PASS  tests/auth.test.js\n"],
    });
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], framework: "vitest", ...deps,
    });
    expect(out).toMatchObject({ ok: true, reason: "red_then_green_verified" });
    expect(deps.runTests).toHaveBeenCalledTimes(2);
  });

  it("fails when new tests still fail after restoring the implementation", async () => {
    const deps = makeDeps({
      outputs: [" FAIL  tests/auth.test.js\n", " FAIL  tests/auth.test.js\n"],
    });
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], framework: "vitest", ...deps,
    });
    expect(out).toMatchObject({ ok: false, reason: "tests_fail_with_impl" });
  });

  it("restores files even if runTests throws", async () => {
    const deps = makeDeps();
    deps.runTests = vi.fn(async () => { throw new Error("boom"); });
    await expect(verifyTddDiscipline({
      sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], framework: "vitest", ...deps,
    })).rejects.toThrow(/boom/);
    expect(deps.restoreFiles).toHaveBeenCalledTimes(1);
  });

  it("recognises pytest failures", async () => {
    const deps = makeDeps({
      outputs: ["FAILED tests/test_auth.py::test_login\n", "1 passed\n"],
    });
    const out = await verifyTddDiscipline({
      sourceFiles: ["src/auth.py"], testFiles: ["tests/test_auth.py"], framework: "pytest", ...deps,
    });
    expect(out).toMatchObject({ ok: true, reason: "red_then_green_verified" });
  });
});
