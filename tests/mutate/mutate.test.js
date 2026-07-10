import { describe, expect, it } from "vitest";
import { mutateCommand } from "../../src/commands/mutate.js";

const line = () => {
  const out = [];
  return { logger: { info: (m) => out.push(m) }, out };
};

// Run results as returned by runMutation/M-C (survivor-carrying vs clean).
const base = { exitCode: 0, stdout: "", stderr: "" };
const survivor = { file: "src/foo.js", line: 8, mutator: "Arithmetic", status: "Survived" };
const withSurvivor = { ...base, result: { score: 50, killed: 1, total: 2, excluded: 0, survived: [survivor] } };
const clean = { ...base, result: { score: 100, killed: 2, total: 2, excluded: 0, survived: [] } };

const deps = (over = {}) => ({
  detectStack: async () => ({ language: "javascript" }),
  diffScope: async () => ({ supported: true, empty: false, tool: "stryker", targets: ["src/foo.js"], args: ["--mutate", "src/foo.js"] }),
  run: async () => withSurvivor,
  ...over,
});

describe("mutateCommand", () => {
  it("reports unsupported languages explicitly (no silent fallback)", async () => {
    const { logger, out } = line();
    const code = await mutateCommand({ logger, deps: deps({ detectStack: async () => ({ language: "swift" }) }) });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/swift/i);
  });

  it("exits 0 with nothing to mutate when the scope is empty", async () => {
    const { logger, out } = line();
    const code = await mutateCommand({ logger, deps: deps({ diffScope: async () => ({ supported: true, empty: true, args: [] }) }) });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/nada que mutar/i);
  });

  it("exits 1 and lists survivors as file:line above the threshold", async () => {
    const { logger, out } = line();
    const code = await mutateCommand({ logger, deps: deps() });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("src/foo.js:8");
  });

  it("exits 0 when survivors are within the threshold", async () => {
    const code = await mutateCommand({ logger: line().logger, maxSurvivors: 1, deps: deps() });
    expect(code).toBe(0);
  });

  it("exits 0 on a clean run", async () => {
    const code = await mutateCommand({ logger: line().logger, deps: deps({ run: async () => clean }) });
    expect(code).toBe(0);
  });

  it("emits normalized JSON with --json", async () => {
    const { logger, out } = line();
    const code = await mutateCommand({ logger, json: true, deps: deps() });
    expect(code).toBe(1);
    expect(JSON.parse(out[0]).survived[0].file).toBe("src/foo.js");
  });

  it("passes an explicit path straight to the tool, bypassing the diff", async () => {
    const calls = [];
    const code = await mutateCommand({
      logger: line().logger,
      path: "src/pkg",
      deps: deps({ run: async (opts) => (calls.push(opts), clean) }),
    });
    expect(code).toBe(0);
    expect(calls[0].args).toEqual(["run", "--mutate", "src/pkg"]);
  });

  it("exits 1 and surfaces stderr when the tool produced no report", async () => {
    const { logger, out } = line();
    const code = await mutateCommand({
      logger,
      deps: deps({ run: async () => ({ exitCode: 1, stdout: "", stderr: "stryker not found", result: null }) }),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/stryker not found/);
  });
});
