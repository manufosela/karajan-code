// KJC-BUG-0233: el guard de rama base (KJC-TSK-0648) protegia siempre "main",
// porque harden leia base_branch del RESULTADO de loadConfig y no de su config.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveBaseBranch } from "../../src/commands/harden.js";

let home, proj, prev;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-bb-home-"));
  proj = mkdtempSync(join(tmpdir(), "kj-bb-proj-"));
  prev = process.env.KJ_HOME;
  process.env.KJ_HOME = home;
  writeFileSync(join(home, "kj.config.yml"), "");
});
afterEach(() => {
  if (prev === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = prev;
  rmSync(home, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

describe("resolveBaseBranch", () => {
  it("honra el base_branch que declara el proyecto (con el loadConfig real)", async () => {
    mkdirSync(join(proj, ".karajan"));
    writeFileSync(join(proj, ".karajan", "kj.config.yml"), "base_branch: develop\n");
    expect(await resolveBaseBranch(proj)).toBe("develop");
  });

  it("sin declararlo, o sin config legible, main", async () => {
    expect(await resolveBaseBranch(proj)).toBe("main");
    expect(await resolveBaseBranch(proj, async () => { throw new Error("no config"); })).toBe("main");
  });
});
