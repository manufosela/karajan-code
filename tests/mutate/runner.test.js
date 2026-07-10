import { describe, expect, it } from "vitest";
import { parseStandardReport, runMutation } from "../../src/mutate/runner.js";

const REPORT = {
  files: {
    "src/foo.js": {
      mutants: [
        { status: "Killed", location: { start: { line: 3 } } },
        { status: "Timeout", location: { start: { line: 5 } } },
        {
          status: "Survived",
          mutatorName: "ArithmeticOperator",
          location: { start: { line: 8 } },
        },
        { status: "Ignored", location: { start: { line: 9 } } },
      ],
    },
    "src/bar.js": {
      mutants: [{ status: "NoCoverage", location: { start: { line: 2 } } }],
    },
  },
};

describe("parseStandardReport", () => {
  it("normalizes a mixed report to score/killed/survived/total", () => {
    const result = parseStandardReport(REPORT);
    expect(result.killed).toBe(2); // Killed + Timeout
    expect(result.total).toBe(4); // 2 killed + 2 survived
    expect(result.excluded).toBe(1); // Ignored
    expect(result.score).toBe(50);
  });

  it("carries file, line and mutator for each survivor (incl. NoCoverage)", () => {
    const { survived } = parseStandardReport(REPORT);
    expect(survived).toEqual([
      { file: "src/foo.js", line: 8, mutator: "ArithmeticOperator", status: "Survived" },
      { file: "src/bar.js", line: 2, mutator: null, status: "NoCoverage" },
    ]);
  });

  it("does not count ignored/equivalent mutants as survivors", () => {
    const report = { files: { a: { mutants: [{ status: "Ignored" }] } } };
    const result = parseStandardReport(report);
    expect(result.survived).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns null score when there is nothing to mutate", () => {
    expect(parseStandardReport({ files: {} }).score).toBeNull();
    expect(parseStandardReport(null).score).toBeNull();
  });
});

describe("runMutation", () => {
  it("executes the binary and parses the report it produced", async () => {
    const calls = [];
    const exec = async (binary, args) => {
      calls.push({ binary, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const readReport = async () => REPORT;
    const out = await runMutation({
      binary: "stryker",
      args: ["run", "--mutate", "src/foo.js"],
      exec,
      readReport,
    });
    expect(calls[0].binary).toBe("stryker");
    expect(out.exitCode).toBe(0);
    expect(out.result.score).toBe(50);
  });

  it("returns a null result when the report cannot be read", async () => {
    const exec = async () => ({ exitCode: 0 });
    const readReport = async () => {
      throw new Error("no report");
    };
    const out = await runMutation({ binary: "mutmut", exec, readReport });
    expect(out.result).toBeNull();
  });
});
