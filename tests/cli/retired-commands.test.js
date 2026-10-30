import { describe, it, expect, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerPipeline } from "../../src/cli/register-pipeline.js";
import { registerPlan } from "../../src/cli/register-plan.js";
import { registerMeta } from "../../src/cli/register-meta.js";
import { registerRetired, retiredMessage, RETIRED } from "../../src/cli/retired-commands.js";

// KJC-TSK-1317: the pipeline commands retired in 5.0 still answer, to say
// what replaced them, and never start an agent.
const buildProgram = () => {
  const program = new Command();
  program.exitOverride();
  const opts = { pkgVersion: "0.0.0-test" };
  registerPipeline(program, opts);
  registerPlan(program, opts);
  registerMeta(program, opts);
  registerRetired(program);
  return program;
};

const run = async (argv) => {
  const writes = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((s) => { writes.push(String(s)); return true; });
  try {
    await buildProgram().parseAsync(["node", "kj", ...argv]);
  } finally {
    spy.mockRestore();
  }
  return writes.join("");
};

afterEach(() => { process.exitCode = undefined; });

describe("retired pipeline commands (KJC-TSK-1317)", () => {
  const cases = [
    ["run", "add a login form", "--task-file", "x.md", "--coder", "claude"],
    ["autorun", "spec"],
    ["resume", "s_123", "--answer", "yes"],
    ["standby", "resume", "s_1"],
    ["status", "-n", "10"],
    ["undo", "--hard"],
    ["triage", "a task"],
    ["researcher", "a task"],
    ["architect", "a task"],
    ["plan", "generate", "--task-file", "SPEC.md"],
    ["review", "a task"],
  ];

  it.each(cases)("kj %s exits 1 with the retirement notice and the migration guide", async (...argv) => {
    const err = await run(argv);
    expect(process.exitCode).toBe(1);
    expect(err).toContain("was retired in 5.0");
    expect(err).toContain("MIGRATION-v5.md");
  });

  it("names what replaces each command", () => {
    expect(retiredMessage("run")).toMatch(/^kj run was retired in 5\.0\. Your agent .*kj review --staged/s);
    expect(retiredMessage("triage")).toContain("kj brief triage");
    expect(retiredMessage("review")).toMatch(/^kj review with a task was retired in 5\.0\. Use kj review --staged/);
    expect(Object.keys(RETIRED)).not.toContain("code");
  });

  it("keeps the retired commands out of the help listing", () => {
    const visible = buildProgram().commands.filter((c) => !c._hidden).map((c) => c.name());
    for (const name of ["run", "autorun", "resume", "standby", "status", "undo", "triage", "researcher", "architect"]) {
      expect(visible).not.toContain(name);
    }
    expect(visible).toEqual(expect.arrayContaining(["code", "review", "plan", "solomon"]));
  });

  it("kj plan keeps every subcommand but generate, and generate is no longer the default", () => {
    const plan = buildProgram().commands.find((c) => c.name() === "plan");
    const visible = plan.commands.filter((c) => !c._hidden).map((c) => c.name());
    expect(visible).toEqual(expect.arrayContaining(["list", "show", "ready", "validate"]));
    expect(visible).not.toContain("generate");
    expect(plan._defaultCommandName).toBeNull();
  });
});
