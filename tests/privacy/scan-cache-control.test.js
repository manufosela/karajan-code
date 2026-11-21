// HU-4724 (#4722): the digits after a Cache-Control age directive are seconds, not a phone.
import { describe, it, expect } from "vitest";
import { scanText } from "../../src/privacy/scan.js";

const list = { personal: [], allow: [] };
const types = (text) => scanText(text, { list }).map((f) => f.type);

describe("Cache-Control age values", () => {
  it("discards the value of each age directive", () => {
    for (const directive of ["max-age", "s-maxage", "stale-while-revalidate", "stale-if-error"]) {
      expect(types(`${directive}=31536000`)).toEqual([]);
    }
    expect(types("max-age=600")).toEqual([]);
  });

  it("discards a full Cache-Control header value", () => {
    expect(types("Cache-Control: public, max-age=31536000, immutable")).toEqual([]);
  });

  it("still reports a bare age number without the directive assignment", () => {
    expect(types("31536000")).toContain("phone");
    expect(types("max-age 600123456")).toContain("phone");
  });

  it("still reports a phone under an unrelated key", () => {
    expect(types("phone=600123456")).toContain("phone");
  });
});
