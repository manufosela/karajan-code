// KJC-BUG-0510: the guidelines block names the commit convention the project resolved.
import { describe, expect, it } from "vitest";

import { guidelinesBody } from "../../src/harden/guidelines-templates.js";

describe("guidelinesBody × commit convention", () => {
  it.each([
    ["project", "the project's own commitlint convention"],
    ["free", "the commit style of the project's history"],
  ])("%s: states the phrase, not Conventional Commits", (commitConvention, phrase) => {
    const body = guidelinesBody("javascript", { commitConvention });
    expect(body).toContain(`- Commits follow ${phrase}. Header <=100 chars.`);
    expect(body).not.toContain("Conventional Commits");
    expect(body).not.toContain("lowercase subject");
    expect(body).toContain("Never attribute commits or PRs to AI");
    expect(body).toContain("Atomic PRs: one purpose");
  });

  it("is unchanged without the option", () => {
    expect(guidelinesBody("javascript")).toBe(guidelinesBody("javascript", { commitConvention: "conventional" }));
    expect(guidelinesBody("javascript")).toContain("- Conventional Commits (`feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:`). Header <=100 chars, lowercase subject.");
  });

  it("rejects an unknown convention", () => {
    expect(() => guidelinesBody("go", { commitConvention: "nope" })).toThrow(/nope/);
  });
});
