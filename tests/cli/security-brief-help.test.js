// HU-4903 (KJC-BUG-0664): the help of `kj security` and `kj brief` says what the code does.
// kj brief has a `board` role its help left out, and "pipeline" names the pipeline retired in 5.0.
// kj security: critical is the default (DEFAULT_LEVEL), a lower level with no phone anywhere is
// recorded unsigned instead of refused (lowerSecurityLevel), and at normal an enrolled phone still
// signs (signAct).
import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerMeta } from "../../src/cli/register-meta.js";
import { BRIEF_ROLES } from "../../src/environment/briefs.js";

const program = () => {
  const p = new Command();
  registerMeta(p, { pkgVersion: "test" });
  return p;
};
const command = (p, name) => p.commands.find((c) => c.name() === name);

describe("kj brief --help (HU-4903)", () => {
  it("names every role the code has, board included", () => {
    const brief = command(program(), "brief");
    const arg = brief.registeredArguments[0].description;
    for (const role of BRIEF_ROLES) expect(arg).toContain(role);
    expect(arg).toContain("board");
  });

  it("no longer speaks of a pipeline", () => {
    expect(command(program(), "brief").description()).not.toMatch(/pipeline/i);
  });
});

describe("kj security --help (HU-4903)", () => {
  it("says critical is the default level", () => {
    expect(command(program(), "security").description()).toMatch(/critical[^.]*default|default[^.]*critical/i);
  });

  it("says normal still signs with a phone that is enrolled", () => {
    expect(command(program(), "security").description()).toMatch(/normal[^.]*enrolled/i);
  });

  it("lowering with no phone is recorded unsigned, never 'refused without one'", () => {
    const security = command(program(), "security");
    for (const level of ["critical", "normal"]) {
      const d = command(security, level).description();
      expect(d).not.toMatch(/refused without one/);
      expect(d).toMatch(/unsigned/);
    }
  });
});
