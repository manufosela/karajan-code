import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatScore,
  getBucketColor,
  getScoreBgColor,
  getScoreColor,
  getStatusColor,
  truncate,
} from "./utils";

describe("formatDate", () => {
  it("formats an ISO string", () => {
    expect(formatDate("2026-03-15T10:30:00Z")).toBe("15 mar 2026");
  });

  it("formats a Date instance", () => {
    expect(formatDate(new Date("2026-03-15T10:30:00Z"))).toBe("15 mar 2026");
  });

  it("accepts a custom pattern", () => {
    expect(formatDate("2026-03-15T10:30:00Z", "yyyy-MM-dd")).toBe("2026-03-15");
  });

  it.each([null, undefined, ""])("returns a dash for %s", (value) => {
    expect(formatDate(value)).toBe("-");
  });

  it("returns a dash for an unparseable string rather than throwing", () => {
    expect(formatDate("not-a-date")).toBe("-");
  });
});

describe("formatScore", () => {
  it("renders one decimal place", () => {
    expect(formatScore(7)).toBe("7.0");
  });

  it("rounds to one decimal place", () => {
    expect(formatScore(7.25)).toBe("7.3");
  });

  it("parses numeric strings, as the API returns decimals as strings", () => {
    expect(formatScore("8.42")).toBe("8.4");
  });

  it("renders zero rather than treating it as absent", () => {
    expect(formatScore(0)).toBe("0.0");
  });

  it.each([null, undefined])("returns a dash for %s", (value) => {
    expect(formatScore(value)).toBe("-");
  });

  it("returns a dash for a non-numeric string", () => {
    expect(formatScore("pending")).toBe("-");
  });
});

describe("getScoreColor", () => {
  it.each([
    [10, "text-emerald-500"],
    [7, "text-emerald-500"],
    [6.9, "text-amber-500"],
    [4, "text-amber-500"],
    [3.9, "text-red-500"],
    [0, "text-red-500"],
  ])("maps %s to %s", (score, expected) => {
    expect(getScoreColor(score)).toBe(expected);
  });

  it("accepts numeric strings", () => {
    expect(getScoreColor("7.5")).toBe("text-emerald-500");
  });
});

describe("getScoreBgColor", () => {
  it.each([
    [9, "bg-emerald-500"],
    [5, "bg-amber-500"],
    [1, "bg-red-500"],
  ])("maps %s to %s", (score, expected) => {
    expect(getScoreBgColor(score)).toBe(expected);
  });
});

describe("getStatusColor", () => {
  it.each([
    "pending",
    "relevant",
    "review",
    "discarded",
    "opportunity",
    "follow_up",
  ] as const)("returns a full class set for %s", (status) => {
    const colors = getStatusColor(status);

    expect(colors.bg).toBeTruthy();
    expect(colors.text).toBeTruthy();
    expect(colors.border).toBeTruthy();
  });

  it("falls back to the pending palette for an unknown status", () => {
    // The API could return a status this build does not know about yet.
    const unknown = getStatusColor("archived" as never);

    expect(unknown).toEqual(getStatusColor("pending"));
  });
});

describe("getBucketColor", () => {
  it("is stable: the same bucket always maps to the same colour", () => {
    expect(getBucketColor("core_aligner_tech")).toEqual(getBucketColor("core_aligner_tech"));
    expect(getBucketColor("")).toEqual(getBucketColor(""));
  });

  it("hashes characters outside the BMP by code point, not by surrogate", () => {
    // U+1D538 and U+1D539 share the same high surrogate: hashing by UTF-16
    // unit would give them the same colour.
    expect(getBucketColor("\u{1D538}")).not.toEqual(getBucketColor("\u{1D539}"));
  });

  it("returns Tailwind classes without the domain-specific bucket palette", () => {
    const colour = getBucketColor("anything");
    expect(colour.bg).toMatch(/^bg-/);
    expect(colour.text).toMatch(/^text-/);
    expect(colour.dot).toMatch(/^bg-/);
    // The old adopt/trial/assess/hold ids and their bg-bucket-* classes are gone.
    expect(colour.dot).not.toContain("bucket-");
  });

  it("is distinguishable: different buckets do not all collapse to one colour", () => {
    const buckets = ["core_aligner_tech", "materials", "digital", "clinical", "manufacturing", "emerging"];
    const dots = new Set(buckets.map((b) => getBucketColor(b).dot));
    expect(dots.size).toBeGreaterThan(1);
  });
});

describe("truncate", () => {
  it("leaves a short string untouched", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("leaves a string of exactly the maximum length untouched", () => {
    expect(truncate("exactly10!", 10)).toBe("exactly10!");
  });

  it("appends an ellipsis when it cuts", () => {
    expect(truncate("abcdefghijk", 5)).toBe("abcde...");
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(truncate("hello world", 6)).toBe("hello...");
  });

  it("handles an empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
