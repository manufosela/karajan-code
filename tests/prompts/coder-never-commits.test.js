// KJC-BUG-0285 (#1982): "atomic commits" read as "commit". The coder committed
// inside its iteration, before the reviewer, and the rejected commit stayed on
// the branch. The coder commits nothing; the pipeline does, once the review approves.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildCoderPrompt } from "../../src/prompts/coder.js";

const ROLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/roles");

describe("the coder never commits (KJC-BUG-0285)", () => {
  it("the built prompt forbids git commit and names who commits", async () => {
    const prompt = await buildCoderPrompt({ task: "add a flag" });
    expect(prompt).toMatch(/NEVER run git commit/);
    expect(prompt).toMatch(/pipeline commits once the cross-AI review approves/);
    expect(prompt).not.toMatch(/1 logical change = 1 commit/);
  });

  it("no coder role prompt asks for atomic commits any more", () => {
    const files = [path.join(ROLES, "coder.md"), ...readdirSync(path.join(ROLES, "coder")).map((f) => path.join(ROLES, "coder", f))];
    const offenders = files.filter((f) => /atomic commits/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
