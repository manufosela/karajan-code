// Tests for Point the Target (KJC-TSK-0605): the highest-impact instructions in
// the coder and reviewer role prompts state what TO do, not only what to avoid.

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const ROLES = path.resolve(import.meta.dirname, "..", "..", "templates", "roles");

describe("point the target — affirmative high-impact instructions (KJC-TSK-0605)", () => {
  it("coder.md states scope and commit gate affirmatively", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "coder.md"), "utf8");
    expect(tpl).toMatch(/Change only the code the task requires/);
    expect(tpl).toMatch(/Commit only code that compiles and passes/);
    expect(tpl).not.toMatch(/Do not modify code unrelated to the task/);
  });

  it("reviewer.md states scope and blocking policy affirmatively", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "reviewer.md"), "utf8");
    expect(tpl).toMatch(/Review only the files present in the diff/);
    expect(tpl).toMatch(/Let style preferences pass; reserve blocking/);
    expect(tpl).not.toMatch(/Style preferences NEVER block approval/);
  });
});
