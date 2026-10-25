// KJC-BUG-0402 (ADR 0030): the Sentinel guards are real modules of the package,
// installed byte for byte. These pin what the move from inline strings could lose.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalHarnessBody } from "../../src/harden/sentinel-hooks.js";
import { CARD_REF_RE } from "../../src/review/card-first.js";
import { CARD } from "../../src/harden/sentinel/sentinel-lib.mjs";

const GUARDS = [
  "sentinel-lib.mjs",
  "posttooluse.mjs",
  "stop.mjs",
  "pretooluse-sentinel.mjs",
  "sentinel-shell.mjs",
  "sentinel-discard.mjs",
  "sentinel-bash-write.mjs",
  "sentinel-reminders.mjs",
  "sessionstart.mjs",
  "sentinel-rules.mjs",
  "pretooluse-rules.mjs",
];

describe("sentinel guards as package modules", () => {
  it("installs every guard exactly as its module in the package", () => {
    for (const name of GUARDS) {
      const module = readFileSync(new URL(`../../src/harden/sentinel/${name}`, import.meta.url), "utf8");
      expect(canonicalHarnessBody(name), name).toBe(module);
    }
  });

  it("the lib's card pattern is the review's own, so the guard and the commit gate agree", () => {
    expect(CARD.source).toBe(CARD_REF_RE.source);
    expect(CARD.flags).toBe(CARD_REF_RE.flags);
  });
});
