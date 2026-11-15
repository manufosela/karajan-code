// HU-4221: what changed in a test file, line by line (slice 1 of docs/specs/test-integrity.md).
import { describe, it, expect } from "vitest";
import { linesOf, compareLines } from "../../src/harden/sentinel/sentinel-test-integrity.mjs";

const NOTHING = { added: [], changed: [], removed: [] };
const BASE = ['it("adds", () => {', "  expect(add(1, 2)).toBe(3);", "  expect(add(2, 2)).toBe(4);", "});"];
const diff = (before, after) => compareLines(linesOf(before.join("\n")), linesOf(after.join("\n")));

describe("linesOf: the non-blank lines, normalised by whitespace only", () => {
  it.each([
    ["collapses each run of whitespace to one space and trims both ends", " \t expect( a ,\t\tb )  ;  ", ["expect( a , b ) ;"]],
    ["drops blank and whitespace-only lines", "a\n\n \t \nb\n", ["a", "b"]],
    ["splits on LF, CRLF and CR", "a\nb\r\nc\rd", ["a", "b", "c", "d"]],
    ["leaves every other character as written", "expect(/\\)/.test(`it's \"a,)\"`));", ["expect(/\\)/.test(`it's \"a,)\"`));"]],
  ])("%s", (_case, text, lines) => expect(linesOf(text)).toEqual(lines));

  it.each([[""], [" \n\t\r\n"], [undefined], [null], [42], [{}], [["a"]]])("gives [] for %j", (text) => {
    expect(linesOf(text)).toEqual([]);
  });
});

describe("compareLines: one edit of a test file is one entry, nothing after it shifts", () => {
  it.each([
    ["an unchanged file gives nothing", BASE, {}],
    ["a pure insertion in the middle is one added, no changed", BASE.toSpliced(2, 0, "  expect(add(0, 0)).toBe(0);"),
      { added: [{ line: "expect(add(0, 0)).toBe(0);", at: 3 }] }],
    ["a pure deletion is one removed", BASE.toSpliced(1, 1), { removed: [{ line: "expect(add(1, 2)).toBe(3);", at: 2 }] }],
    ["an edited expected value is one changed", BASE.with(2, "  expect(add(2, 2)).toBe(5);"),
      { changed: [{ before: "expect(add(2, 2)).toBe(4);", after: "expect(add(2, 2)).toBe(5);", at: 3 }] }],
    ["it( to it.skip( is one changed", BASE.with(0, 'it.skip("adds", () => {'),
      { changed: [{ before: 'it("adds", () => {', after: 'it.skip("adds", () => {', at: 1 }] }],
  ])("%s", (_case, after, want) => expect(diff(BASE, after)).toEqual({ ...NOTHING, ...want }));
});

describe("compareLines: the edits that hid from reading assertions are one changed each", () => {
  it.each([
    ["a comma inside a string", 'expect(v).toBe("a,)");', 'expect(v).toBe("a)");'],
    ["a regex literal with parentheses", "expect(/\\)/.test(x)).toBe(true);", "expect(/\\)/.test(x)).toBe(false);"],
    ["a quote inside a template literal", "expect(t).toBe(`it's 1`);", "expect(t).toBe(`it's 2`);"],
  ])("%s", (_case, before, after) =>
    expect(diff(BASE.with(2, before), BASE.with(2, after))).toEqual({ ...NOTHING, changed: [{ before, after, at: 3 }] }));
});

describe("compareLines: whitespace-only edits give nothing", () => {
  it.each([
    ["re-indented with tabs", BASE, BASE.map((line) => line.replace(/^ +/, "\t\t"))],
    ["a run of spaces and tabs inside a line", BASE, BASE.with(1, "  expect(add(1, \t  2)).toBe(3);")],
    ["trailing spaces and tabs", BASE, BASE.map((line) => `${line} \t`)],
    ["blank lines added", BASE, BASE.flatMap((line) => [line, "", " \t"])],
    ["blank lines removed", BASE.flatMap((line) => ["", line]), BASE],
    ["CRLF line ends", BASE, BASE.map((line) => `${line}\r`)],
  ])("%s", (_case, before, after) => expect(diff(before, after)).toEqual(NOTHING));
});

describe("compareLines: lists, gaps and pairs", () => {
  it.each([
    ["two empty files give nothing", linesOf(""), linesOf(""), {}],
    ["null and undefined give nothing", null, undefined, {}],
    ["null before is an empty list: every line is added", null, ["a", "b"], { added: [{ line: "a", at: 1 }, { line: "b", at: 2 }] }],
    ["undefined after is an empty list: every line is removed", ["a", "b"], undefined,
      { removed: [{ line: "a", at: 1 }, { line: "b", at: 2 }] }],
    ["a gap of two before and three after: two changed in order, one added", ["k", "a", "b", "z"], ["k", "x", "y", "w", "z"],
      { changed: [{ before: "a", after: "x", at: 2 }, { before: "b", after: "y", at: 3 }], added: [{ line: "w", at: 4 }] }],
    ["a gap of three before and one after: one changed, two removed", ["k", "a", "b", "c", "z"], ["k", "x", "z"],
      { changed: [{ before: "a", after: "x", at: 2 }], removed: [{ line: "b", at: 3 }, { line: "c", at: 4 }] }],
    ["lines on either side of a kept line do not pair", ["a", "k"], ["k", "x"],
      { removed: [{ line: "a", at: 1 }], added: [{ line: "x", at: 2 }] }],
    ["two gaps pair apart", ["a", "k", "b"], ["x", "k", "y"],
      { changed: [{ before: "a", after: "x", at: 1 }, { before: "b", after: "y", at: 3 }] }],
  ])("%s", (_case, before, after, want) => expect(compareLines(before, after)).toEqual({ ...NOTHING, ...want }));

  it.each([["a string", "a"], ["a number", 1], ["an object", {}]])("refuses %s in place of a list", (_case, bad) => {
    expect(() => compareLines(bad, [])).toThrow(TypeError);
    expect(() => compareLines([], bad)).toThrow(TypeError);
  });
});
