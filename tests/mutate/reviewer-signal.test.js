import { describe, expect, it } from "vitest";
import { isMutationReviewEnabled, buildReviewerMutationSignal } from "../../src/mutate/reviewer-signal.js";

const withSurvivors = { code: 0, result: { score: 50, killed: 1, total: 2, survived: [{ file: "src/foo.js", line: 8, mutator: "Arithmetic", status: "Survived" }] } };
const clean = { code: 0, result: { score: 100, killed: 2, total: 2, survived: [] } };

describe("isMutationReviewEnabled", () => {
  it("is off by default (no env var)", () => {
    expect(isMutationReviewEnabled({})).toBe(false);
  });

  it("accepts the usual truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isMutationReviewEnabled({ KJ_REVIEW_MUTATION: v })).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const v of ["0", "false", "off", "no", "", "maybe"]) {
      expect(isMutationReviewEnabled({ KJ_REVIEW_MUTATION: v })).toBe(false);
    }
  });
});

describe("buildReviewerMutationSignal", () => {
  it("returns null when disabled (default off → byte-identical prompt)", async () => {
    const run = async () => withSurvivors;
    expect(await buildReviewerMutationSignal({ enabled: false, run })).toBeNull();
  });

  it("returns null on a clean run (nothing to flag)", async () => {
    const run = async () => clean;
    expect(await buildReviewerMutationSignal({ enabled: true, run })).toBeNull();
  });

  it("returns null when there is nothing to mutate", async () => {
    const run = async () => ({ code: 0, result: null });
    expect(await buildReviewerMutationSignal({ enabled: true, run })).toBeNull();
  });

  it("lists survivors as file:line when there are undetected mutants", async () => {
    const run = async () => withSurvivors;
    const signal = await buildReviewerMutationSignal({ enabled: true, run });
    expect(signal).toContain("src/foo.js:8");
    expect(signal).toMatch(/mutation/i);
  });

  it("notes unavailability on an unsupported language (exit 2) — no silent drop", async () => {
    const run = async () => ({ code: 2, result: null });
    const signal = await buildReviewerMutationSignal({ enabled: true, run });
    expect(signal).toMatch(/unavailable|could not/i);
  });

  it("notes unavailability when the tool produced no report (exit 1)", async () => {
    const run = async () => ({ code: 1, result: null });
    const signal = await buildReviewerMutationSignal({ enabled: true, run });
    expect(signal).toMatch(/unavailable|could not/i);
  });

  it("notes unavailability when the run throws", async () => {
    const run = async () => { throw new Error("boom"); };
    const signal = await buildReviewerMutationSignal({ enabled: true, run });
    expect(signal).toMatch(/unavailable|could not/i);
  });
});
