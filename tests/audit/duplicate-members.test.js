import { describe, it, expect } from "vitest";
import { findDuplicateMembers } from "../../src/audit/duplicate-members.js";
import { evaluateDuplicateMembers, VERDICTS } from "../../src/steward/invariants.js";
import { sweepDuplicateMembers } from "../../src/steward/phantom-sweep.js";

const dups = (src, file = "a.js") => findDuplicateMembers(src, { file }).duplicates;

describe("findDuplicateMembers", () => {
  it("reports a method defined twice with both lines", () => {
    const src = "class A extends LitElement {\n  updated() {}\n  other() {}\n  updated() {}\n}";
    expect(dups(src)).toEqual([{ class: "A", member: "updated", lines: [2, 4] }]);
  });
  it("does not flag a getter + setter pair", () => {
    expect(dups("class A { get x() { return 1; } set x(v) {} }")).toEqual([]);
  });
  it("does not flag static + instance with the same name", () => {
    expect(dups("class A { static f() {} f() {} }")).toEqual([]);
  });
  it("flags two getters and a method + field clash", () => {
    expect(dups("class A { get x() { return 1; } get x() { return 2; } }")).toHaveLength(1);
    expect(dups("class A { y = 1; y() {} }")[0].member).toBe("y");
  });
  it("flags a method and a getter with the same name", () => {
    expect(dups("class A { x() {} get x() { return 1; } }")).toEqual([{ class: "A", member: "x", lines: [1, 1] }]);
  });
  it("skips computed keys and reads class expressions", () => {
    expect(dups("class A { [k]() {} [k]() {} }")).toEqual([]);
    expect(dups("const B = class { m() {} m() {} };")[0].class).toBe("(anonymous)");
  });
  it("is not observable when the source does not parse", () => {
    const r = findDuplicateMembers("class {{{", { file: "a.js" });
    expect(r.observable).toBe(false);
    expect(r.reason).toMatch(/parsed/);
  });
});

describe("evaluateDuplicateMembers", () => {
  const dup = { file: "a.js", observable: true, duplicates: [{ class: "A", member: "updated", lines: [2, 4] }] };
  it("is broken with file:line, class and member", () => {
    const r = evaluateDuplicateMembers({ results: [dup] });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toContain("a.js:2/4 A.updated");
    expect(r.remedy).toMatch(/last definition silently wins/);
  });
  it("is ok when files were analysed and none duplicates", () => {
    expect(evaluateDuplicateMembers({ results: [{ file: "b.js", observable: true, duplicates: [] }] }).verdict).toBe(VERDICTS.OK);
  });
  it("is not observable with nothing to analyse, naming unparsed files", () => {
    const r = evaluateDuplicateMembers({ results: [{ file: "c.js", observable: false, reason: "x" }] });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toContain("c.js");
    expect(evaluateDuplicateMembers({ results: [] }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
  it("is not observable, never ok, when some files could not be parsed", () => {
    const r = evaluateDuplicateMembers({ results: [{ file: "b.js", observable: true, duplicates: [] }, { file: "c.js", observable: false, reason: "x" }] });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toContain("c.js");
  });
});

describe("sweepDuplicateMembers", () => {
  it("reads sources, skipping tests and non-code", () => {
    const sources = { "src/a.js": "class A { m() {} m() {} }", "src/a.test.js": "class T { m() {} m() {} }", "README.md": "x" };
    const { results } = sweepDuplicateMembers({ projectDir: "/x", files: Object.keys(sources), read: (f) => sources[f] });
    expect(results.map((r) => r.file)).toEqual(["src/a.js"]);
    expect(results[0].duplicates).toHaveLength(1);
  });
  it("records a file it cannot read as not observable; a vanished one is skipped", () => {
    const read = (f) => { const e = new Error(f === "src/gone.js" ? "missing" : "denied"); e.code = f === "src/gone.js" ? "ENOENT" : "EACCES"; throw e; };
    const { results } = sweepDuplicateMembers({ projectDir: "/x", files: ["src/gone.js", "src/locked.js"], read });
    expect(results).toEqual([{ file: "src/locked.js", observable: false, reason: "could not be read (denied)" }]);
  });
});
