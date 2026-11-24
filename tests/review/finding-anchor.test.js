// HU-4835 (KJC-TSK-1730, épica KJC-PCS-0113): one deterministic rule, no model, for whether a
// reviewer finding cites something real: its file, its line and the code it quotes.
import { describe, expect, it } from "vitest";

import { anchorFinding } from "../../src/review/finding-anchor.js";

const DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "+const b = eval(input);",
  " export { a };",
  "",
].join("\n");

// The staged tree as the review sees it: src/a.js changed, src/twin.js untouched (an ADR 0010 twin).
const FILES = {
  "src/a.js": "const a = 1;\nconst b = eval(input);\nexport { a };\n",
  "src/twin.js": "export function readHome() {\n  return process.env.KJ_HOME;\n}\n",
};
const readFile = (path) => FILES[path] ?? null;
const anchor = (finding) => anchorFinding({ severity: "high", category: "correctness", ...finding }, { diff: DIFF, readFile });

describe("anchorFinding", () => {
  it("a finding on a changed line of the diff is anchored in-diff", () => {
    expect(anchor({ file: "src/a.js", line: 2, description: "`eval(input)` runs untrusted code" })).toMatchObject({ anchored: true, reason: "in-diff" });
  });

  it("with a line, a cited added line is in-diff without any quoted code", () => {
    expect(anchor({ file: "src/a.js", line: 2, description: "this line needs a guard" })).toMatchObject({ anchored: true, reason: "in-diff" });
  });

  it("a finding on an untouched file that exists, at a line it has, is anchored outside-diff (the twin)", () => {
    expect(anchor({ file: "src/twin.js", line: 2, description: "`KJ_HOME` was renamed elsewhere" })).toMatchObject({ anchored: true, reason: "outside-diff" });
  });

  it("a finding on an unchanged line of a changed file is anchored outside-diff", () => {
    expect(anchor({ file: "src/a.js", line: 1, description: "`const a` is never used" })).toMatchObject({ anchored: true, reason: "outside-diff" });
  });

  it("without a line, a changed file is in-diff only when its quoted code sits on an added line", () => {
    expect(anchor({ file: "src/a.js", line: null, description: "`eval(input)` runs untrusted code" })).toMatchObject({ anchored: true, reason: "in-diff" });
    expect(anchor({ file: "src/a.js", line: null, description: "`export { a }` leaks a" })).toMatchObject({ anchored: true, reason: "outside-diff" });
    expect(anchor({ file: "src/a.js", line: null, description: "naming is unclear" })).toMatchObject({ anchored: true, reason: "outside-diff" });
  });

  it("a file that does not exist is not anchored: missing-file", () => {
    expect(anchor({ file: "src/ghost.js", line: 3, description: "bug" })).toMatchObject({ anchored: false, reason: "missing-file" });
  });

  it("a line past the end of the file is not anchored: missing-line", () => {
    expect(anchor({ file: "src/a.js", line: 40, description: "bug" })).toMatchObject({ anchored: false, reason: "missing-line" });
  });

  it("quoted code that is not near the cited line is not anchored: snippet-mismatch", () => {
    expect(anchor({ file: "src/a.js", line: 2, description: "`exec(cmd)` is unsafe" })).toMatchObject({ anchored: false, reason: "snippet-mismatch" });
  });

  it("one quoted span that matches is enough: the others may be the suggested code", () => {
    expect(anchor({ file: "src/a.js", line: 2, description: "replace `eval(input)` with `JSON.parse(input)`" })).toMatchObject({ anchored: true });
  });

  it("without a line, the file is enough, and quoted code is looked up in the whole file", () => {
    expect(anchor({ file: "src/twin.js", line: null, description: "`readHome` reads the old variable" })).toMatchObject({ anchored: true, reason: "outside-diff" });
    expect(anchor({ file: "src/twin.js", line: null, description: "`writeHome` is never called" })).toMatchObject({ anchored: false, reason: "snippet-mismatch" });
  });

  it("a finding about the whole diff (no file) cannot be anchored and is not called false", () => {
    expect(anchor({ file: null, line: null, description: "the change has no tests" })).toMatchObject({ anchored: true, reason: "whole-diff" });
  });

  it("a security or critical finding that does not anchor stays protected: nobody downgrades it", () => {
    expect(anchor({ file: "src/ghost.js", line: 1, category: "security", description: "leak" })).toMatchObject({ anchored: false, protected: true });
    expect(anchor({ file: "src/ghost.js", line: 1, severity: "critical", description: "crash" })).toMatchObject({ anchored: false, protected: true });
    expect(anchor({ file: "src/ghost.js", line: 1, description: "bug" })).toMatchObject({ anchored: false, protected: false });
  });
});
