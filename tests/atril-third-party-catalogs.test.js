// HU-3198 (#3198): the repo declares third-party catalogs, each pinned to a commit, so atril
// indexes them and every task decides what to install. Nothing that collides with Karajan's method.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const read = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const { catalogs } = read("../.karajan/atril.json");
const { sources } = read("../catalogs/third-party.json");
const OUT_FOR_GOOD = ["obra/superpowers", "ralph", "ecc", "loki-mode", "get-shit-done", "compound-engineering-plugin", "planning-with-files", "open-code-review"];
describe("third-party catalogs", () => {
  it("atril.json lists the sources file", () => {
    expect(catalogs).toContain("catalogs/third-party.json");
  });
  it("pins every source to a 40-hex commit and says what it is for", () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const { source, commit, note } of sources) {
      expect(commit, source).toMatch(/^[0-9a-f]{40}$/);
      expect(note.trim(), source).not.toBe("");
    }
  });
  it("lists no source twice", () => {
    const declared = sources.map(({ source }) => source.toLowerCase());
    expect(new Set(declared).size).toBe(declared.length);
  });
  it("pins the reviewed security-audit source", () => {
    const entry = sources.find(({ source }) => source === "cloudflare/security-audit-skill/skills");
    expect(entry).toBeDefined();
    expect(entry.commit).toBe("c1c8a8c1471069fb0e188eeaff69b8e8db6564a8");
    expect(entry.note).toContain("MIT");
  });
  it("declares nothing that collides with Karajan's method", () => {
    const declared = sources.map(({ source }) => source.toLowerCase());
    for (const banned of OUT_FOR_GOOD) expect(declared.some((s) => s.includes(banned)), banned).toBe(false);
  });
});
