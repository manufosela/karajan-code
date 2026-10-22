// KJC-TSK-1118: data reserved for testing is the good practice a QA engineer
// follows (feedback from the QA team), so it must not warn: fictional phone
// ranges (NANP 555-01xx, Ofcom's drama ranges) and the test card numbers payment
// providers publish. Only those exact forms; their neighbours still warn.
import { describe, it, expect } from "vitest";
import { scanText } from "../../src/privacy/scan.js";

const list = { personal: [], allow: [] };
const types = (text) => scanText(text, { list }).map((f) => f.type);

describe("data reserved for testing", () => {
  it.each([
    "call (212) 555-0123", "+1 415 555 0150", "tel 212.555.0100",
    "mobile 07700 900123", "+44 7700 900456", "020 7946 0123", "01632 960555",
  ])("discards the fictional phone %s", (line) => {
    expect(types(line)).toEqual([]);
    expect(scanText(line, { list }).discardedByContext).toBe(1);
  });

  it.each([
    "4242 4242 4242 4242", "4111111111111111", "5555-5555-5555-4444", "378282246310005", "6011111111111117",
  ])("discards the published test card %s", (line) => {
    expect(types(`card ${line}`)).toEqual([]);
  });

  // Composed, not literal: they must warn, and this file would warn on every review.
  const near = (...parts) => parts.join("");
  it.each([
    [near("(212) 555-", "0200"), "phone"], [near("+1 415 555 ", "1150"), "phone"], [near("07700 ", "901123"), "phone"], [near("020 7946 ", "1123"), "phone"],
    [near("4111111111", "111112"), "creditCard"], [near("4242 4242 ", "4242 4241"), "creditCard"],
  ])("still warns on the neighbour %s", (line, type) => {
    expect(types(line)).toContain(type);
  });
});
