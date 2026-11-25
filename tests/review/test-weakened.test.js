// HU-4872 (KJC-TSK-1762): a diff that removes an assertion from a test that already existed is a fact,
// test-weakened, with its file, its line in the base and the assertion it removed. Deterministic, no model.
import { describe, expect, it } from "vitest";
import { diffFacts } from "../../src/review/diff-facts.js";

const list = { personal: [], allow: [] };
const weakened = (diff) => diffFacts(diff, { list }).filter((f) => f.kind === "test-weakened");

const existingTest = (body) => [
  "diff --git a/tests/sum.test.js b/tests/sum.test.js",
  "index 1111111..2222222 100644",
  "--- a/tests/sum.test.js",
  "+++ b/tests/sum.test.js",
  ...body,
].join("\n");

describe("test-weakened (HU-4872)", () => {
  it("is a fact when an assertion of an existing test is removed", () => {
    const facts = weakened(existingTest([
      "@@ -10,4 +10,3 @@ describe(\"sum\", () => {",
      "   it(\"adds\", () => {",
      "-    expect(sum(1, 2)).toBe(3);",
      "     expect(typeof sum).toBe(\"function\");",
      "   });",
    ]));
    expect(facts).toEqual([
      { kind: "test-weakened", file: "tests/sum.test.js", line: 11, text: "removes the assertion expect(sum(1, 2)).toBe(3);" },
    ]);
  });

  it("counts assert calls too", () => {
    const facts = weakened(existingTest(["@@ -3,2 +3,1 @@", "-    assert.equal(total, 3);", "     done();"]));
    expect(facts.map((f) => f.line)).toEqual([3]);
  });

  it("is no fact when the same assertion moves inside the file", () => {
    expect(weakened(existingTest([
      "@@ -10,3 +10,3 @@",
      "-    expect(sum(1, 2)).toBe(3);",
      "     const x = 1;",
      "+    expect(sum(1, 2)).toBe(3);",
    ]))).toEqual([]);
  });

  it("a rewrite on the same subject is not test-weakened but an assertion-rewritten fact the reviewer judges", () => {
    const rewrite = (before, after) => existingTest(["@@ -10,2 +10,2 @@", `-    ${before}`, `+    ${after}`]);
    const stricter = rewrite("expect(result).toBeTruthy();", "expect(result).toStrictEqual({ ok: true, total: 3 });");
    const looser = rewrite("expect(result).toBe(3);", "expect(result).toBeTruthy();");
    expect(weakened(stricter)).toEqual([]);
    expect(weakened(looser)).toEqual([]);
    expect(diffFacts(looser, { list }).filter((f) => f.kind === "assertion-rewritten")).toEqual([
      { kind: "assertion-rewritten", file: "tests/sum.test.js", line: 10, text: "rewrites the assertion expect(result).toBe(3); as expect(result).toBeTruthy();" },
    ]);
  });

  it("is no fact when the assertion moves to another test file of the diff, a new one included", () => {
    const moved = [
      existingTest(["@@ -10,2 +10,1 @@", "-    expect(sum(1, 2)).toBe(3);", "     done();"]),
      "diff --git a/tests/sum-extra.test.js b/tests/sum-extra.test.js",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tests/sum-extra.test.js",
      "@@ -0,0 +1,1 @@",
      "+  expect(sum(1, 2)).toBe(3);",
    ].join("\n");
    expect(weakened(moved)).toEqual([]);
  });

  it("is no fact in a new test file, nor in a file that is not a test", () => {
    const newFile = [
      "diff --git a/tests/new.test.js b/tests/new.test.js",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tests/new.test.js",
      "@@ -0,0 +1,1 @@",
      "+expect(1).toBe(1);",
    ].join("\n");
    const source = [
      "diff --git a/src/check.js b/src/check.js",
      "--- a/src/check.js",
      "+++ b/src/check.js",
      "@@ -5,1 +5,0 @@",
      "-  assert(input, \"input required\");",
    ].join("\n");
    expect(weakened(newFile)).toEqual([]);
    expect(weakened(source)).toEqual([]);
  });
});
