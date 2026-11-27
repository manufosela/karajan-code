// HU-4954: the pieces section (index, Sentinel, ledger) exists in both languages and has its sidebar group.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docs = (rel) => readFileSync(fileURLToPath(new URL(`../../apps/landing/docs/${rel}`, import.meta.url)), "utf8");
const SLUGS = ["pieces", "pieces/sentinel", "pieces/ledger"];
const FILES = ["pieces/index", "pieces/sentinel", "pieces/ledger"];
const LANGS = ["", "es/"];

describe("pieces docs, HU-4954", () => {
  for (const lang of LANGS) {
    for (const file of FILES) {
      it(`${lang || "en/"}${file} exists, has a title and no em dashes`, () => {
        const text = docs(`src/content/docs/${lang}${file}.md`);
        expect(text).toMatch(/^---\ntitle: .+/);
        expect(text).not.toContain("—");
      });
    }
  }

  it("the sidebar lists the three slugs with a Spanish translation", () => {
    const lines = docs("astro.config.mjs").split("\n");
    for (const slug of SLUGS) {
      const line = lines.find((l) => l.includes(`slug: '${slug}'`));
      expect(line).toMatch(/translations: \{ es: '.+' \}/);
    }
  });

  it("the pieces group sits between Start here and The method", () => {
    const config = docs("astro.config.mjs");
    const start = config.indexOf("label: 'Start here'");
    const pieces = config.indexOf("label: 'The pieces', translations: { es: 'Las piezas' }");
    const method = config.indexOf("label: 'The method'");
    expect(start).toBeGreaterThan(-1);
    expect(pieces).toBeGreaterThan(start);
    expect(method).toBeGreaterThan(pieces);
  });
});
