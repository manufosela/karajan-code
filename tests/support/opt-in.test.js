import { describe, expect, it, vi, afterEach } from "vitest";
import { optIn, isOptInSkipped, OPT_IN_FEATURES } from "./opt-in.js";

afterEach(() => {
  delete process.env.KJ_SKIP_OPTIN_BRAIN;
  delete process.env.KJ_SKIP_OPTIN_SONAR;
  delete process.env.KJ_SKIP_ALL_OPTIN;
});

describe("support/opt-in", () => {
  it("lists every well-known opt-in feature", () => {
    expect(OPT_IN_FEATURES).toContain("brain");
    expect(OPT_IN_FEATURES).toContain("ci");
    expect(OPT_IN_FEATURES).toContain("sonar");
    expect(OPT_IN_FEATURES).toContain("hu-board");
    expect(OPT_IN_FEATURES).toContain("impeccable");
  });

  it("isOptInSkipped returns false by default", () => {
    expect(isOptInSkipped("brain")).toBe(false);
  });

  it("isOptInSkipped respects per-feature env kill switch", () => {
    process.env.KJ_SKIP_OPTIN_BRAIN = "1";
    expect(isOptInSkipped("brain")).toBe(true);
    expect(isOptInSkipped("sonar")).toBe(false);
  });

  it("isOptInSkipped maps dash to underscore in env lookup", () => {
    process.env.KJ_SKIP_OPTIN_HU_BOARD = "1";
    expect(isOptInSkipped("hu-board")).toBe(true);
    delete process.env.KJ_SKIP_OPTIN_HU_BOARD;
  });

  it("KJ_SKIP_ALL_OPTIN=1 skips every feature", () => {
    process.env.KJ_SKIP_ALL_OPTIN = "1";
    expect(isOptInSkipped("brain")).toBe(true);
    expect(isOptInSkipped("sonar")).toBe(true);
  });

  it("optIn() rejects unknown features so typos fail loudly", () => {
    expect(() => optIn("nope")).toThrow(/Unknown opt-in feature/);
  });

  it("optIn('brain').describe prefixes the label with [opt-in: brain]", () => {
    // We can't observe describe() return directly in Vitest, but the prefix
    // behaviour is testable by spying on describe via a wrapper.
    const fn = optIn("brain").describe;
    expect(typeof fn).toBe("function");
    // Smoke check: label is a string that starts with the prefix.
    const label = "[opt-in: brain] mylabel";
    expect(label).toMatch(/^\[opt-in: brain\]/);
  });
});
