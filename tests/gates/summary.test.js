// KJC-BUG-0510: the text kj writes into AGENTS.md/CLAUDE.md names the project's commit convention.
import { describe, expect, it } from "vitest";

import { commitConventionOf, commitConventionPhrase } from "../../src/gates/summary.js";

describe("commitConventionPhrase", () => {
  it("names each convention", () => {
    expect(commitConventionPhrase("conventional")).toBe("Conventional Commits");
    expect(commitConventionPhrase("project")).toBe("the project's own commitlint convention");
    expect(commitConventionPhrase("free")).toBe("the commit style of the project's history");
  });

  it("throws on an unknown value instead of falling back", () => {
    expect(() => commitConventionPhrase("whatever")).toThrow(/whatever/);
  });
});

describe("commitConventionOf", () => {
  it("reads the value the project layer resolved", () => {
    const signals = () => ({ project: { "commit-convention": { value: "free", evidence: "x" } }, conflicts: [], stale: [] });
    expect(commitConventionOf({ config: null, projectDir: "/nowhere", signals })).toBe("free");
  });

  it("is conventional when the project says nothing", () => {
    const signals = () => ({ project: {}, conflicts: [], stale: [] });
    expect(commitConventionOf({ config: null, projectDir: "/nowhere", signals })).toBe("conventional");
  });
});
