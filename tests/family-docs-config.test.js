import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sources } from "../apps/landing/docs/scripts/family-docs.config.mjs";

describe("family-docs sources", () => {
  it("pins the atril source to the rebased readme commit", () => {
    const atril = sources.find((source) => source.path === "packages/atril/README.md");
    expect(atril?.ref).toBe("1f93ff844b77afbffd1f2683c35ff657f103286d");
  });

  it("cites only ADRs that exist in .karajan/adrs", () => {
    const configUrl = new URL("../apps/landing/docs/scripts/family-docs.config.mjs", import.meta.url);
    const cited = [...readFileSync(configUrl, "utf8").matchAll(/ADR (\d{4})/g)].map((m) => m[1]);
    const adrs = readdirSync(new URL("../.karajan/adrs/", import.meta.url));
    expect(cited.length).toBeGreaterThan(0);
    for (const number of cited) {
      expect(adrs.some((file) => file.startsWith(`${number}-`))).toBe(true);
    }
  });
});
