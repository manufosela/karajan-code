// KJC-TSK-1523: kj review leaves one line per check of TDD, the Steward and Sonar in the lane's
// .karajan/traces/method.jsonl, so kj stage shows each piece at work.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { METHOD_FILE, traceMethod } from "../../src/review/method-trace.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-method-trace-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const lines = () => fs.readFileSync(path.join(dir, METHOD_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("traceMethod", () => {
  it("appends the piece and whether it passed, in a kj project", () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    traceMethod(dir, { piece: "tdd", passed: true });
    traceMethod(dir, { piece: "sonar", passed: false });
    expect(lines()).toEqual([
      { at: expect.any(String), piece: "tdd", outcome: "pass" },
      { at: expect.any(String), piece: "sonar", outcome: "refuse" },
    ]);
  });

  it("writes nothing outside a kj project, nor for a piece it does not know", () => {
    traceMethod(dir, { piece: "tdd", passed: true });
    expect(fs.existsSync(path.join(dir, ".karajan"))).toBe(false);
    fs.mkdirSync(path.join(dir, ".karajan"));
    traceMethod(dir, { piece: "oracle", passed: true });
    expect(fs.existsSync(path.join(dir, METHOD_FILE))).toBe(false);
  });

  it("a trace it cannot write never stops the review", () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    fs.writeFileSync(path.join(dir, ".karajan", "traces"), "a file where the folder should be");
    expect(() => traceMethod(dir, { piece: "steward", passed: true })).not.toThrow();
  });
});
