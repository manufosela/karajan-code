import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  SHARED_DIR_NAME,
  getSharedRoot,
  getSharedPlansDir,
  getSharedHuStoriesDir,
  isSharedPath,
} from "../../src/utils/shared-paths.js";

describe("shared-paths — KJC-PRP-0002 PR1", () => {
  const projectDir = "/tmp/fake/project";

  it("exposes the canonical dir name", () => {
    expect(SHARED_DIR_NAME).toBe(".karajan-shared");
  });

  it("builds the shared root under <projectDir>/.karajan-shared", () => {
    expect(getSharedRoot(projectDir)).toBe(path.join(projectDir, ".karajan-shared"));
  });

  it("builds plans and hu-stories subdirs", () => {
    expect(getSharedPlansDir(projectDir)).toBe(path.join(projectDir, ".karajan-shared", "plans"));
    expect(getSharedHuStoriesDir(projectDir)).toBe(path.join(projectDir, ".karajan-shared", "hu-stories"));
  });

  it("isSharedPath flags paths under the shared dir", () => {
    expect(isSharedPath(path.join(projectDir, ".karajan-shared", "plans", "plan-x.json"))).toBe(true);
    expect(isSharedPath(path.join(projectDir, "src", "x.js"))).toBe(false);
    expect(isSharedPath(null)).toBe(false);
    expect(isSharedPath("")).toBe(false);
  });

  it("isSharedPath only matches the exact segment, not substrings", () => {
    // A directory called `my.karajan-shared.bak` must NOT match.
    expect(isSharedPath(path.join(projectDir, "my.karajan-shared.bak", "x"))).toBe(false);
  });
});
