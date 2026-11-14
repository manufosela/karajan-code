// KJC-BUG-0595: epoch-millisecond JSON values are not credit cards; real cards still are.
import { describe, it, expect } from "vitest";
import { scanText } from "../../src/privacy/scan.js";

const list = { personal: [], allow: [] };
const types = (text) => scanText(text, { list }).map((f) => f.type);

describe("epoch milliseconds under a time key", () => {
  it("discards issuedMs and expiresMs values", () => {
    expect(types('{"issuedMs": 1794505513776, "expiresMs": 1794506113776}')).toEqual([]);
    expect(types('"createdAt": 1794505513776')).toEqual([]);
    expect(types('"timestamp":1794505513776')).toEqual([]);
  });

  it("still reports a card number in plain text", () => {
    expect(types("pay with 4012888888881882 now")).toContain("creditCard");
  });

  it("still reports a card as the value of a time-looking key", () => {
    expect(types('"cardMs": 4012888888881882')).toContain("creditCard");
    expect(types('"cardMs": 4222222222222')).toContain("creditCard");
  });

  it("does not discard a bare 13-digit number or a non-time key", () => {
    expect(types("1794505513776")).toContain("creditCard");
    expect(types('"cardNumber": 1794505513776')).toContain("creditCard");
  });
});
