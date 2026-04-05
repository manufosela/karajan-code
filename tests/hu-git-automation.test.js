import { describe, it, expect } from "vitest";
import { buildHuBranchName, resolveHuBase } from "../src/git/hu-automation.js";

describe("buildHuBranchName", () => {
  it("builds branch name with prefix, id and slug", () => {
    const story = { id: "HU-01", title: "Setup project infrastructure" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-01-setup-project-infrastructure");
  });

  it("slugifies special chars", () => {
    const story = { id: "HU-02", title: "Auth & User CRUD (v2)" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-02-auth-user-crud-v2");
  });

  it("truncates long titles", () => {
    const story = { id: "HU-03", title: "a".repeat(100) };
    const name = buildHuBranchName("feat/", story);
    expect(name.length).toBeLessThanOrEqual("feat/HU-03-".length + 40);
  });

  it("falls back to id when no title", () => {
    const story = { id: "HU-04" };
    expect(buildHuBranchName("feat/", story)).toBe("feat/HU-04-hu-04");
  });

  it("respects custom prefix", () => {
    const story = { id: "HU-05", title: "Fix bug" };
    expect(buildHuBranchName("chore/hu/", story)).toBe("chore/hu/HU-05-fix-bug");
  });
});

describe("resolveHuBase", () => {
  it("returns baseBranch for HU with no dependencies", () => {
    const story = { id: "HU-01", blocked_by: [] };
    const branches = new Map();
    expect(resolveHuBase(story, branches, "main")).toBe("main");
  });

  it("returns parent branch when HU depends on another HU", () => {
    const story = { id: "HU-02", blocked_by: ["HU-01"] };
    const branches = new Map([["HU-01", "feat/HU-01-setup"]]);
    expect(resolveHuBase(story, branches, "main")).toBe("feat/HU-01-setup");
  });

  it("returns last parent when multiple parents exist", () => {
    const story = { id: "HU-03", blocked_by: ["HU-01", "HU-02"] };
    const branches = new Map([
      ["HU-01", "feat/HU-01-setup"],
      ["HU-02", "feat/HU-02-auth"]
    ]);
    expect(resolveHuBase(story, branches, "main")).toBe("feat/HU-02-auth");
  });

  it("falls back to baseBranch when parent branches not yet created", () => {
    const story = { id: "HU-02", blocked_by: ["HU-01"] };
    const branches = new Map();
    expect(resolveHuBase(story, branches, "main")).toBe("main");
  });
});
