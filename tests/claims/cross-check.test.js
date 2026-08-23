// CLM-A (KJC-TSK-0801, ADR "claims with evidence") — the case that motivated this:
// the assistant was about to tell the user "four cards are waiting for validation";
// the board had answered with an empty list. A datum denied by its own source is a
// proven hallucination, and it is the only verdict that blocks.
import { describe, it, expect } from "vitest";
import { crossCheck, formatClaimReport, BACKED, UNBACKED, DENIED, NOT_CHECKABLE } from "../../src/claims/cross-check.js";

const statusOf = (result, value) => result.claims.find((c) => c.value === value)?.status;

describe("crossing what was said against what ran", () => {
  it("the real case: a count contradicted by the output that should back it is DENIED", () => {
    const result = crossCheck({
      text: "Hay 4 cards esperando tu validación.",
      outputs: ["mcp list_cards status=To Validate → []  (0 cards)"],
    });
    expect(statusOf(result, "4")).toBe(DENIED);
    expect(formatClaimReport(result)).toMatch(/DENIED/);
  });

  it("a datum present in some output is BACKED, whatever its kind", () => {
    const result = crossCheck({
      text: "Escaneé 1004 ficheros, publiqué la 0.3.0 y mergeé #1535 en src/guards/duplicate-members.js (KJC-TSK-0796).",
      outputs: [
        "1004 files · 0 duplicate member(s) · 0 not observable",
        "+ @karajan-family/console@0.3.0",
        "1535 feat(guards): catch a class member declared twice",
        "create mode 100644 src/guards/duplicate-members.js",
        "card KJC-TSK-0796 updated",
      ],
    });
    for (const v of ["1004", "0.3.0", "1535", "src/guards/duplicate-members.js", "KJC-TSK-0796"]) {
      expect(statusOf(result, v), `${v} should be backed`).toBe(BACKED);
    }
    expect(result.denied).toEqual([]);
    expect(result.unbacked).toEqual([]);
  });

  it("what the user wrote is a source too: repeating it back is not inventing", () => {
    const result = crossCheck({ text: "Publico la 0.3.0 en KJC-TSK-0798 como pediste.", outputs: [], userSaid: "publica la 0.3.0, es la de KJC-TSK-0798" });
    expect(statusOf(result, "0.3.0")).toBe(BACKED);
    expect(statusOf(result, "KJC-TSK-0798")).toBe(BACKED);
  });

  it("a datum with no trace anywhere is UNBACKED — reported, not blocked", () => {
    const result = crossCheck({ text: "La suite tiene 812 tests.", outputs: ["Tests  53 passed (53)"] });
    expect(statusOf(result, "812")).toBe(UNBACKED);
    expect(result.denied).toEqual([]);
    expect(formatClaimReport(result)).toMatch(/no backing/);
  });

  it("admitting it is unverified is respected: nothing to report", () => {
    const result = crossCheck({ text: "De memoria, sin comprobar: quedan 5 cards de REWORK.", outputs: [] });
    expect(result.claims).toEqual([]);
  });

  it("does not cry wolf: tiny numbers in prose are NOT_CHECKABLE, not accusations", () => {
    const result = crossCheck({ text: "Son 2 capas y 3 reglas.", outputs: [] });
    expect(statusOf(result, "2")).toBe(NOT_CHECKABLE);
    expect(statusOf(result, "3")).toBe(NOT_CHECKABLE);
    expect(result.unbacked).toEqual([]);
  });

  // Found by running this over a REAL message of the session: "4" was backed because it appears
  // inside "24,6 kB". Numbers must match as whole tokens or the guard backs figures nobody measured.
  it("a number is only backed as a whole token, never as a fragment of another number", () => {
    const result = crossCheck({
      text: "Publiqué la 0.3.0 (17 ficheros, 24,6 kB) y escaneé 1004 ficheros. Quedan 4 cards esperando validación.",
      outputs: [
        "npm notice total files: 17\nnpm notice package size: 24.6 kB\n+ @karajan-family/console@0.3.0",
        "1004 files · 0 duplicate member(s)",
        "mcp list_cards type=task status=To Validate → []",
      ],
    });
    expect(statusOf(result, "17")).toBe(BACKED);
    expect(statusOf(result, "1004")).toBe(BACKED);
    expect(statusOf(result, "4")).toBe(DENIED); // NOT backed by the "4" inside 24.6
    expect(result.denied).toHaveLength(1);
  });

});
