import { describe, expect, it } from "vitest";
import { parseJsonOutput, parseMaybeJsonString, normalizeReviewPayload } from "../../src/review/parser.js";

describe("parseJsonOutput", () => {
  it("parses valid JSON with approved and blocking_issues", () => {
    const raw = JSON.stringify({ approved: true, blocking_issues: [], summary: "OK" });
    const result = parseJsonOutput(raw);
    expect(result.approved).toBe(true);
    expect(result.blocking_issues).toEqual([]);
  });

  it("returns null for empty string", () => {
    expect(parseJsonOutput("")).toBeNull();
    expect(parseJsonOutput("   ")).toBeNull();
  });

  it("returns null for non-JSON garbage", () => {
    expect(parseJsonOutput("not json at all")).toBeNull();
  });

  it("extracts review from multiline output with one valid JSON line", () => {
    const raw = [
      "Some log output",
      JSON.stringify({ approved: false, blocking_issues: [{ id: "1" }] }),
      "More log"
    ].join("\n");
    const result = parseJsonOutput(raw);
    expect(result.approved).toBe(false);
    expect(result.blocking_issues).toHaveLength(1);
  });

  it("prefers last valid JSON line when multiple exist", () => {
    const raw = [
      JSON.stringify({ approved: true, blocking_issues: [] }),
      "garbage",
      JSON.stringify({ approved: false, blocking_issues: [{ id: "x" }] })
    ].join("\n");
    const result = parseJsonOutput(raw);
    // parsedLines path: normalizeReviewPayload on array picks last match
    expect(result).toBeTruthy();
  });

  it("handles JSON wrapped in extra text", () => {
    const json = { approved: true, blocking_issues: [], summary: "All good" };
    const raw = `Here is my review:\n${JSON.stringify(json)}\nEnd.`;
    const result = parseJsonOutput(raw);
    expect(result).toBeTruthy();
    expect(result.approved).toBe(true);
  });
});

describe("parseMaybeJsonString", () => {
  it("parses valid JSON string", () => {
    const result = parseMaybeJsonString('{"approved": true}');
    expect(result.approved).toBe(true);
  });

  it("returns null for non-string input", () => {
    expect(parseMaybeJsonString(123)).toBeNull();
    expect(parseMaybeJsonString(null)).toBeNull();
    expect(parseMaybeJsonString(undefined)).toBeNull();
  });

  it("extracts JSON from string with surrounding text", () => {
    const result = parseMaybeJsonString('prefix {"approved": false, "x": 1} suffix');
    expect(result.approved).toBe(false);
  });

  it("returns null for string without braces", () => {
    expect(parseMaybeJsonString("no json here")).toBeNull();
  });

  it("returns null for invalid JSON inside braces", () => {
    expect(parseMaybeJsonString("{ not: valid json }")).toBeNull();
  });
});

describe("normalizeReviewPayload", () => {
  it("returns null for null/undefined", () => {
    expect(normalizeReviewPayload(null)).toBeNull();
    expect(normalizeReviewPayload(undefined)).toBeNull();
  });

  it("returns payload directly if it has approved and blocking_issues", () => {
    const payload = { approved: true, blocking_issues: [], summary: "OK" };
    expect(normalizeReviewPayload(payload)).toBe(payload);
  });

  it("extracts review from array (last match wins)", () => {
    const arr = [
      { some: "data" },
      { approved: true, blocking_issues: [] },
      { approved: false, blocking_issues: [{ id: "1" }] }
    ];
    const result = normalizeReviewPayload(arr);
    expect(result.approved).toBe(false);
  });

  it("extracts review from nested result string in array", () => {
    const inner = JSON.stringify({ approved: true, blocking_issues: [] });
    const arr = [{ result: inner }];
    const result = normalizeReviewPayload(arr);
    expect(result.approved).toBe(true);
  });

  it("extracts review from payload.result string", () => {
    const inner = JSON.stringify({ approved: false, blocking_issues: [{ id: "x" }] });
    const payload = { result: inner };
    const result = normalizeReviewPayload(payload);
    expect(result.approved).toBe(false);
  });

  it("returns null for payload with result string that has no review", () => {
    expect(normalizeReviewPayload({ result: "just text" })).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(normalizeReviewPayload([])).toBeNull();
  });

  it("returns null for object without approved field", () => {
    expect(normalizeReviewPayload({ foo: "bar" })).toBeNull();
  });

  // KJC-BUG-0146 — the shape that produced eight "no parseable verdict" in three days,
  // taken literally from the raw answer saved by this bug's first fix: codex wraps the
  // verdict in {ok, result} with result as an OBJECT, and only the string form was unwrapped.
  it("unwraps a verdict wrapped as {ok, result} with result as an object", () => {
    const wrapped = {
      ok: true,
      result: { approved: true, blocking_issues: [], non_blocking_suggestions: ["use String.raw"], confidence: 0.84 },
      summary: "Approved: no blocking issues",
    };
    const result = normalizeReviewPayload(wrapped);
    expect(result).toMatchObject({ approved: true, confidence: 0.84 });
    expect(result.non_blocking_suggestions).toHaveLength(1);
  });

  it("unwraps a rejection the same way: the wrapper must never turn a no into a lost verdict", () => {
    const wrapped = { ok: true, result: { approved: false, blocking_issues: [{ id: "leak", severity: "high" }] } };
    expect(normalizeReviewPayload(wrapped).approved).toBe(false);
  });

  it("a wrapper whose result is not a verdict is still null: unwrapping is not guessing", () => {
    expect(normalizeReviewPayload({ ok: true, result: { status: "done" } })).toBeNull();
    expect(normalizeReviewPayload({ ok: true, result: null })).toBeNull();
  });
});
