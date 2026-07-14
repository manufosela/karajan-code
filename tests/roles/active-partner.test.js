// Tests for the Active Partner / constructive dissent guidance (KJC-TSK-0603).
// The coder and spec-reviewer role prompts must give relevance-gated permission
// to surface real blockers WITHOUT manufacturing trivial objections.

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const ROLES = path.resolve(import.meta.dirname, "..", "..", "templates", "roles");

describe("active partner — constructive dissent (KJC-TSK-0603)", () => {
  it("coder.md lets the coder raise real blockers before coding", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "coder.md"), "utf8");
    expect(tpl).toMatch(/Active Partner/);
    expect(tpl).toMatch(/false or impossible premise/i);
    expect(tpl).toContain("result.concerns");
  });

  it("coder.md keeps the bar high — no manufactured or trivial dissent", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "coder.md"), "utf8");
    expect(tpl).toMatch(/do NOT manufacture doubts/i);
    expect(tpl).toMatch(/Relevance is the test/i);
    expect(tpl).toMatch(/"concerns":\s*\[\]/);
  });

  it("spec-reviewer.md flags false premises instead of rationalising them", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "spec-reviewer.md"), "utf8");
    expect(tpl).toMatch(/false premise/i);
    expect(tpl).toMatch(/never rationalise/i);
  });
});

describe("check alignment micro-gate (KJC-TSK-0604)", () => {
  it("coder.md gates the alignment step to moderate/complex tasks", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "coder.md"), "utf8");
    expect(tpl).toMatch(/Check alignment/i);
    expect(tpl).toMatch(/moderate or (high|complex)/i);
    expect(tpl).toContain("result.alignment");
  });

  it("coder.md skips the alignment step for trivial or small tasks", async () => {
    const tpl = await fs.readFile(path.join(ROLES, "coder.md"), "utf8");
    expect(tpl).toMatch(/Do NOT add this step for trivial/i);
    expect(tpl).toMatch(/"alignment":\s*null/);
  });
});
