// HU-4861 (KJC-TSK-1781): lanes and the operating contract have their own docs page, in both languages.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docs = (rel) => readFileSync(fileURLToPath(new URL(`../../apps/landing/docs/${rel}`, import.meta.url)), "utf8");
const page = (lang, slug) => docs(`src/content/docs/${lang}guides/${slug}.md`);
const PAGES = ["lanes", "operating-contract"];
const LANGS = ["", "es/"];

describe("governance pieces docs, HU-4861", () => {
  for (const lang of LANGS) {
    for (const slug of PAGES) {
      it(`${lang || "en/"}${slug} exists, has a title and no em dashes`, () => {
        const text = page(lang, slug);
        expect(text).toMatch(/^---\ntitle: .+/);
        expect(text).not.toContain("—");
      });
    }
    it(`${lang || "en/"}lanes names the three commands and ADR 0034`, () => {
      const text = page(lang, "lanes");
      for (const sub of ["start", "list", "done"]) expect(text).toContain(`kj worktree ${sub}`);
      expect(text).toContain("ADR 0034");
    });
  }

  it("the sidebar lists both slugs with a Spanish translation", () => {
    const config = docs("astro.config.mjs");
    for (const slug of PAGES) {
      const line = config.split("\n").find((l) => l.includes(`slug: 'guides/${slug}'`));
      expect(line).toMatch(/translations: \{ es: '.+' \}/);
    }
  });
});
