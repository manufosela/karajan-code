// HU-4737: the Sonar layout is read from the committed copy at the base ref.
import { describe, it, expect, vi } from "vitest";
import { readBaseSonarLayout } from "../../src/review/sonar-layout.js";

const EMPTY = { tests: [], testInclusions: [], testExclusions: [], exclusions: [] };
const PROPS = "sonar.tests=tests\nsonar.exclusions=dist/**\n";

describe("readBaseSonarLayout", () => {
  it("parses the file as committed at base, through git show only", async () => {
    const run = vi.fn(async () => PROPS);
    const layout = await readBaseSonarLayout({ cwd: "/repo", base: "origin/main", run });
    expect(layout).toEqual({ ...EMPTY, tests: ["tests"], exclusions: ["dist/**"] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(["show", "origin/main:sonar-project.properties"], "/repo");
  });

  it("returns the empty layout when the file is absent at that ref or git fails", async () => {
    const run = async () => { throw new Error("fatal: path does not exist"); };
    expect(await readBaseSonarLayout({ cwd: "/repo", base: "main", run })).toEqual(EMPTY);
  });

  it("returns the empty layout for an empty or absent base without calling git", async () => {
    const run = vi.fn(async () => PROPS);
    expect(await readBaseSonarLayout({ cwd: "/repo", base: "", run })).toEqual(EMPTY);
    expect(await readBaseSonarLayout({ cwd: "/repo", run })).toEqual(EMPTY);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the empty layout when git prints nothing", async () => {
    expect(await readBaseSonarLayout({ cwd: "/repo", base: "main", run: async () => "" })).toEqual(EMPTY);
  });
});
