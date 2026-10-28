import { describe, expect, it } from "vitest";
import { bannerFor, missingMessage, noMarkMessage, staleMessage } from "../apps/landing/docs/scripts/family-docs-lang.mjs";

describe("family-docs source language", () => {
  it("keeps the Spanish banner by default and in 'es'", () => {
    expect(bannerFor(undefined, "r@v1:f.md", "abc")).toContain("NO EDITAR A MANO");
    expect(bannerFor("es", "r@v1:f.md", "abc")).toContain("NO EDITAR A MANO");
  });

  it("writes an English banner for an English source", () => {
    const banner = bannerFor("en", "r@sha:README.md", "abc");
    expect(banner).toContain("DO NOT EDIT BY HAND");
    expect(banner).toContain("synced-from: r@sha:README.md · section-sha256: abc");
  });

  it("rejects an unknown language instead of falling back", () => {
    expect(() => bannerFor("fr", "l", "h")).toThrow(/sourceLang.*fr/);
    expect(() => bannerFor("constructor", "l", "h")).toThrow(/sourceLang.*constructor/);
    expect(() => missingMessage("fr", "p", "l")).toThrow(/sourceLang/);
    expect(() => noMarkMessage("fr", "p")).toThrow(/sourceLang/);
    expect(() => staleMessage("fr", "x/p.md", "a", "b")).toThrow(/sourceLang.*fr/);
  });

  it("names the translation directory in the stale message", () => {
    expect(staleMessage("en", "es/atril/p.md", "a".repeat(64), "b".repeat(64))).toMatch(
      /es\/atril\/p\.md.*translates aaaaaaaaaaaa….*bbbbbbbbbbbb…/,
    );
  });
});
