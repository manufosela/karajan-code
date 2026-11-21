import { describe, it, expect } from "vitest";
import { parseSonarLayout, globToRegExp, classifyBySonar } from "../../src/review/sonar-layout.js";

const layoutOf = (over = {}) => ({ tests: [], testInclusions: [], testExclusions: [], exclusions: [], ...over });

describe("parseSonarLayout", () => {
  it("reads the four keys as trimmed comma lists without empty items", () => {
    const text = "sonar.tests = tests, e2e ,,\nsonar.test.inclusions=**/*.test.js\nsonar.test.exclusions=tests/fixtures/**\nsonar.exclusions=dist/**,\n";
    expect(parseSonarLayout(text)).toEqual({
      tests: ["tests", "e2e"],
      testInclusions: ["**/*.test.js"],
      testExclusions: ["tests/fixtures/**"],
      exclusions: ["dist/**"],
    });
  });

  it("skips # and ! comments and accepts the : separator", () => {
    const text = "# sonar.tests=nope\n! sonar.exclusions=nope\nsonar.tests: tests\nsonar.exclusions : dist/";
    expect(parseSonarLayout(text)).toEqual(layoutOf({ tests: ["tests"], exclusions: ["dist/"] }));
  });

  it("joins backslash continuation lines", () => {
    const text = "sonar.exclusions=dist/**,\\\n   build/**,\\\n  out/**\nsonar.tests=tests";
    const layout = parseSonarLayout(text);
    expect(layout.exclusions).toEqual(["dist/**", "build/**", "out/**"]);
    expect(layout.tests).toEqual(["tests"]);
  });

  it("continues on an odd run of trailing backslashes, not on an even one", () => {
    expect(parseSonarLayout("sonar.tests=a\\\\\\\nb").tests).toEqual(["a\\\\b"]);
    expect(parseSonarLayout("sonar.tests=a\\\\\nsonar.exclusions=x").exclusions).toEqual(["x"]);
  });

  it("gives empty lists for absent keys and ignores other keys", () => {
    expect(parseSonarLayout("sonar.projectKey=x\n")).toEqual(layoutOf());
    expect(parseSonarLayout("")).toEqual(layoutOf());
  });
});

describe("globToRegExp", () => {
  it.each([
    ["**/*.js", "a.js", true], ["**/*.js", "a/b/c.js", true], ["**/*.js", "a/b/c.ts", false],
    ["src/*.js", "src/a.js", true], ["src/*.js", "src/x/a.js", false],
    ["a?.js", "ab.js", true], ["a?.js", "a/.js", false], ["a?.js", "a.js", false],
    ["tests/", "tests/a/b.js", true], ["tests/", "tests", false], ["tests/", "mytests/a.js", false],
    ["./src/a+b.ts", "src/a+b.ts", true], ["./src/a+b.ts", "src/aab.ts", false],
    ["./src/a+b.ts", "src/a+bxts", false], ["(x[1]", "(x[1]", true],
    ["e2e/a+b/fixtures.ts", "e2e/a+b/fixtures.ts", true], ["e2e/a+b/fixtures.ts", "e2e/aab/fixtures.ts", false],
    ["e2e/a+b/fixtures.ts", "e2e/a+b/fixtures.tsx", false], ["e2e/a+b/fixtures.ts", "xe2e/a+b/fixtures.ts", false],
  ])("glob %s against %s is %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
describe("classifyBySonar", () => {
  const layout = layoutOf({
    tests: ["tests"],
    testInclusions: ["**/*.test.js"],
    testExclusions: ["tests/fixtures/**"],
    exclusions: ["dist/**"],
  });

  it.each([
    ["is test when under tests and included", layout, "tests/a/b.test.js", "test"],
    ["is null when under tests but not included", layout, "tests/helper.js", null],
    ["is null when under tests but test-excluded", layout, "tests/fixtures/x.test.js", null],
    ["is excluded when sonar.exclusions matches, before anything else", { ...layout, tests: ["dist"] }, "dist/a.test.js", "excluded"],
    ["is null outside tests", layout, "src/a.test.js", null],
    ["is null for an empty layout", layoutOf(), "tests/a.test.js", null],
    ["counts every file under tests when there are no inclusions", layoutOf({ tests: ["tests/"] }), "tests/any/file.txt", "test"],
    ["accepts a glob as a tests entry", layoutOf({ tests: ["packages/*/test"] }), "packages/a/test/x.js", "test"],
  ])("%s", (_name, lay, path, expected) => {
    expect(classifyBySonar(lay, path)).toBe(expected);
  });
  it("does not throw on a hostile pattern", () => {
    expect(() => classifyBySonar(layoutOf({ exclusions: ["(((", "[a-"] }), "x.js")).not.toThrow();
  });
});
