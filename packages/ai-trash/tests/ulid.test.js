import { describe, it, expect } from "vitest";

import { ulid, decodeTimeFromUlid } from "../src/ulid.js";

describe("ulid", () => {
  it("produces lexicographically ordered ids in time order", () => {
    const a = ulid(1_000_000);
    const b = ulid(1_000_000 + 5);
    expect(b > a).toBe(true);
    expect(decodeTimeFromUlid(a)).toBe(1_000_000);
    expect(decodeTimeFromUlid(b)).toBe(1_000_005);
  });

  it("stays monotonic within the same millisecond", () => {
    const a = ulid(2_000_000);
    const b = ulid(2_000_000);
    expect(b > a).toBe(true);
  });

  it("emits 26-character Crockford base32 ids", () => {
    const id = ulid(1_500_000);
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("rejects invalid characters in decodeTimeFromUlid", () => {
    expect(() => decodeTimeFromUlid("ILOU0000000000000000000000")).toThrow(
      /invalid char/
    );
  });
});
