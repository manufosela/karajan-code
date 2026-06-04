import { describe, expect, it, vi } from "vitest";
import { runTddDisciplineStage } from "../../../src/orchestrator/stages/tdd-discipline-stage.js";

function makeDeps({ framework = "vitest", outputs = ["", ""] } = {}) {
  return {
    detectFramework: vi.fn(async () => ({ framework })),
    runTestsImpl: vi.fn(async () => ({ exitCode: 0, output: outputs.shift() ?? "" })),
    stashImpl: vi.fn(async () => ({ trackedStashRef: null, untrackedMoves: [], marker: "M" })),
    restoreImpl: vi.fn(async () => undefined),
  };
}

const baseArgs = {
  config: { projectDir: "/tmp/x" },
  logger: { warn: vi.fn() },
  emitter: { emit: vi.fn() },
  eventBase: {},
};

describe("runTddDisciplineStage", () => {
  it("returns ok with framework_unsupported when detection has no framework", async () => {
    const deps = makeDeps({ framework: null });
    const out = await runTddDisciplineStage({
      ...baseArgs, sourceFiles: ["src/x.js"], testFiles: ["tests/x.test.js"], ...deps,
    });
    expect(out.action).toBe("ok");
    expect(out.result.reason).toBe("framework_unsupported");
    expect(deps.runTestsImpl).not.toHaveBeenCalled();
  });

  it("returns continue when new tests pass without the implementation", async () => {
    const deps = makeDeps({ outputs: ["", ""] });
    const out = await runTddDisciplineStage({
      ...baseArgs, sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], ...deps,
    });
    expect(out.action).toBe("continue");
    expect(out.result.reason).toBe("tests_pass_without_impl");
    expect(deps.stashImpl).toHaveBeenCalledTimes(1);
    expect(deps.restoreImpl).toHaveBeenCalledTimes(1);
  });

  it("returns ok on red-then-green happy path", async () => {
    const deps = makeDeps({
      outputs: [" FAIL  tests/auth.test.js\n", " PASS  tests/auth.test.js\n"],
    });
    const out = await runTddDisciplineStage({
      ...baseArgs, sourceFiles: ["src/auth.js"], testFiles: ["tests/auth.test.js"], ...deps,
    });
    expect(out.action).toBe("ok");
    expect(out.result.reason).toBe("red_then_green_verified");
  });

  it("recognises pytest framework via detector", async () => {
    const deps = makeDeps({
      framework: "pytest",
      outputs: ["FAILED tests/test_auth.py::t\n", "1 passed\n"],
    });
    const out = await runTddDisciplineStage({
      ...baseArgs, sourceFiles: ["src/auth.py"], testFiles: ["tests/test_auth.py"], ...deps,
    });
    expect(out.action).toBe("ok");
    expect(deps.detectFramework).toHaveBeenCalledWith("/tmp/x");
  });

  it("skips when there are no source files", async () => {
    const deps = makeDeps();
    const out = await runTddDisciplineStage({
      ...baseArgs, sourceFiles: [], testFiles: ["tests/x.test.js"], ...deps,
    });
    expect(out.action).toBe("ok");
    expect(out.result.reason).toBe("no_source_changes");
    expect(deps.stashImpl).not.toHaveBeenCalled();
  });
});
