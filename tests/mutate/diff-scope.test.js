import { describe, expect, it } from "vitest";
import {
  buildScope,
  filterSourceFiles,
  getDiffScope,
  parseUnifiedDiff,
} from "../../src/mutate/diff-scope.js";

// Only `+++ ` and `@@ ` lines drive the parser; other diff noise is elided.
const SAMPLE_DIFF = [
  "+++ b/src/foo.js",
  "@@ -10,0 +11,3 @@", // multi-line hunk -> [11,13]
  "@@ -40,2 +44 @@", // count omitted -> [44,44]
  "+++ b/README.md",
  "@@ -1 +1,2 @@",
  "+++ /dev/null", // deleted file: everything after is skipped
  "@@ -1,3 +0,0 @@",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("extracts new-side ranges per file and skips deleted files", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    expect(parsed["src/foo.js"]).toEqual([[11, 13], [44, 44]]);
    expect(parsed["README.md"]).toEqual([[1, 2]]);
    expect(parsed["src/gone.js"]).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual({});
  });
});

describe("filterSourceFiles", () => {
  it("keeps only files matching the language extensions", () => {
    const files = ["src/a.js", "src/b.ts", "README.md", "src/c.py"];
    expect(filterSourceFiles(files, "javascript")).toEqual(["src/a.js"]);
    expect(filterSourceFiles(files, "python")).toEqual(["src/c.py"]);
    expect(filterSourceFiles(["a.swift"], "swift")).toEqual([]);
  });
});

describe("buildScope", () => {
  it("appends line ranges to Stryker targets", () => {
    const scope = buildScope({
      language: "javascript",
      files: ["src/foo.js"],
      ranges: { "src/foo.js": [[11, 13], [44, 44]] },
    });
    expect(scope.tool).toBe("stryker");
    expect(scope.args).toEqual(["--mutate", "src/foo.js:11-13,src/foo.js:44-44"]);
  });

  it("uses plain paths for tools without line-range scoping (php)", () => {
    const scope = buildScope({
      language: "php",
      files: ["src/A.php", "src/B.php"],
    });
    expect(scope.args).toEqual(["--filter", "src/A.php,src/B.php"]);
  });

  it("returns empty scope when no supported source files changed", () => {
    const scope = buildScope({ language: "javascript", files: ["README.md"] });
    expect(scope.empty).toBe(true);
    expect(scope.args).toEqual([]);
  });

  it("surfaces unsupported languages explicitly (no silent fallback)", () => {
    const scope = buildScope({ language: "swift", files: ["App.swift"] });
    expect(scope.supported).toBe(false);
    expect(scope.reason.length).toBeGreaterThan(0);
    expect(scope.args).toEqual([]);
  });
});

describe("getDiffScope", () => {
  it("computes scope from an injected git runner", async () => {
    const run = async () => ({ exitCode: 0, stdout: SAMPLE_DIFF });
    const scope = await getDiffScope({ since: "HEAD~1", language: "javascript", run });
    expect(scope.tool).toBe("stryker");
    expect(scope.targets).toEqual(["src/foo.js:11-13", "src/foo.js:44-44"]);
  });

  it("staged=true scopea al índice (--cached), jamás un rango vacío HEAD..HEAD (MUT-A, catch de codex)", async () => {
    const calls = [];
    const run = async (_cmd, args) => { calls.push(args); return { exitCode: 0, stdout: SAMPLE_DIFF }; };
    const scope = await getDiffScope({ staged: true, language: "javascript", run });
    expect(calls[0]).toEqual(["diff", "--unified=0", "--cached"]);
    expect(scope.empty).toBe(false);
  });

  it("returns empty scope when git diff fails", async () => {
    const run = async () => ({ exitCode: 128, stdout: "" });
    const scope = await getDiffScope({ since: "bad", language: "javascript", run });
    expect(scope.empty).toBe(true);
  });
});
