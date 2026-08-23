// CLM-A (KJC-TSK-0801, ADR "claims with evidence") — what counts as a checkable
// datum in what the AI says. Prose is not verifiable; counts, versions, paths,
// card ids, PR numbers and SHAs are. Everything else is left alone on purpose.
import { describe, it, expect } from "vitest";
import { extractClaims } from "../../src/claims/extract.js";

const values = (text) => extractClaims(text).map((c) => `${c.kind}:${c.value}`);

describe("hard data in a text", () => {
  it("picks the kinds that can be checked, and only those", () => {
    expect(values("Mergeé #1535 con 1004 ficheros en src/guards/duplicate-members.js para KJC-TSK-0796, y publiqué la 0.3.0.")).toEqual([
      "card:KJC-TSK-0796",
      "path:src/guards/duplicate-members.js",
      "version:0.3.0",
      "pr:1535",
      "count:1004",
    ]);
  });

  it("a number is claimed once, as the most specific kind that matches", () => {
    const claims = extractClaims("Mergeé #1535 y #1535 otra vez. Esto es una frase sin datos.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: "pr", value: "1535" });
    expect(claims[0].sentence).toContain("Mergeé");
  });

  // A bare number cannot be verified from prose, and some of them are secrets: an OTP
  // must never end up quoted inside a report.
  it("a bare number with no unit is never extracted", () => {
    expect(extractClaims("El OTP es 899890.")).toEqual([]);
    expect(extractClaims("Son las 1030.")).toEqual([]);
  });

  it("a sentence that admits it is unverified is respected, and only that sentence", () => {
    expect(extractClaims("De memoria, quedan 5 cards de REWORK.")).toEqual([]);
    expect(values("De memoria, quedan 5 cards. Escaneé 1004 ficheros.")).toEqual(["count:1004"]);
    expect(extractClaims("Creo que hay 12 hotspots.")).toEqual([]);
  });

  it("keeps the sentence with each datum, because a figure without its claim cannot be judged", () => {
    const [claim] = extractClaims("La suite pasa 53 tests.");
    expect(claim).toMatchObject({ kind: "count", value: "53", sentence: "La suite pasa 53 tests." });
  });

  it("thousands separators do not create a different number", () => {
    expect(values("Revisé 1.004 ficheros.")).toEqual(["count:1004"]);
  });
});
