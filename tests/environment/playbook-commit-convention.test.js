// KJC-BUG-0510: the playbook names the commit convention the project resolved.
import { describe, expect, it } from "vitest";

import { renderPlaybook } from "../../src/environment/playbook.js";

describe("renderPlaybook × commit convention", () => {
  it("free: no Conventional Commits, the phrase instead, same size", () => {
    const text = renderPlaybook({ commitConvention: "free" });
    expect(text).not.toContain("Conventional Commits");
    expect(text).toContain("the commit style of the project's history");
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
    expect(text.split("\n").length).toBe(renderPlaybook({}).split("\n").length);
  });

  it("defaults to Conventional Commits", () => {
    expect(renderPlaybook({})).toContain("Conventional Commits");
  });
});
