import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerPipeline } from "../../src/cli/register-pipeline.js";
import { registerPlan } from "../../src/cli/register-plan.js";
import { registerRolesSkills } from "../../src/cli/register-roles-skills.js";
import { registerMeta } from "../../src/cli/register-meta.js";
import { registerSonar } from "../../src/cli/register-sonar.js";
import { registerStandby } from "../../src/cli/register-standby.js";
import {
  CORE_COMMANDS,
  ADVANCED_COMMANDS,
  ADVANCED_GROUPS,
  META_COMMANDS,
  classifyCommand,
  isAdvancedCommand,
} from "../../src/cli/advanced-commands.js";

/** Build the real CLI command tree exactly as src/cli.js does. */
function buildProgram() {
  const program = new Command();
  const opts = { pkgVersion: "0.0.0-test" };
  registerPipeline(program, opts);
  registerPlan(program, opts);
  registerRolesSkills(program, opts);
  registerMeta(program, opts);
  registerSonar(program);
  registerStandby(program);
  return program;
}

describe("advanced-commands registry (KJC-TSK-0582)", () => {
  it("classifies every registered top-level command (no drift)", () => {
    const program = buildProgram();
    const unknown = program.commands
      .map((c) => c.name())
      .filter((name) => classifyCommand(name) === "unknown");
    expect(unknown).toEqual([]);
  });

  it("every classified command is actually registered", () => {
    const program = buildProgram();
    const registered = new Set(program.commands.map((c) => c.name()));
    registered.add("advanced"); // registered in registerMeta, present above
    for (const name of [...CORE_COMMANDS, ...ADVANCED_COMMANDS]) {
      expect(registered.has(name), `'${name}' classified but not registered`).toBe(true);
    }
  });

  it("core, advanced and meta sets are disjoint", () => {
    const overlap = CORE_COMMANDS.filter((n) => ADVANCED_COMMANDS.includes(n) || META_COMMANDS.includes(n));
    expect(overlap).toEqual([]);
  });

  it("no advanced command appears in two groups", () => {
    const seen = new Set();
    const dupes = [];
    for (const group of ADVANCED_GROUPS) {
      for (const name of group.commands) {
        if (seen.has(name)) dupes.push(name);
        seen.add(name);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("isAdvancedCommand hides advanced, keeps core/meta visible", () => {
    expect(isAdvancedCommand("audit")).toBe(true);
    expect(isAdvancedCommand("run")).toBe(false);
    expect(isAdvancedCommand("advanced")).toBe(false);
  });
});
