// KJC-TSK-1350: the pages of the v3 historical archive (handbook, examples, faq, flows...) still
// show `kj run` as the way to work. They stay as history, but each one says so on top and links
// to the 5.0 migration. One list decides which pages those are, for the sidebar and the notice.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isArchivePage, ARCHIVE_PAGES, ARCHIVE_GROUPS } from "../apps/landing/docs/src/archive.mjs";

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "landing", "docs");

describe("isArchivePage", () => {
  it.each(["handbook/commands/run", "es/handbook/commands/run", "examples/fix-a-bug", "es/examples/howto/go", "faq", "es/faq", "getting-started/quick-start", "reference/cli", "guides/flows"])(
    "%s is a v3 archive page",
    (id) => expect(isArchivePage(id)).toBe(true),
  );

  it.each(["v4/migration", "es/v4/install", "guides/sentinel", "guides/hu-board", "karagan", "watch/design", "index", "es", "guides/flowsx", "handbookx/a", "", undefined])(
    "%s is not",
    (id) => expect(isArchivePage(id)).toBe(false),
  );
});

describe("the archive list", () => {
  it("names pages that exist, in English and in Spanish", () => {
    for (const { slug } of ARCHIVE_PAGES) {
      for (const base of ["", "es/"]) {
        const found = [".md", ".mdx"].some((ext) => fs.existsSync(path.join(DOCS, "src", "content", "docs", `${base}${slug}${ext}`)));
        expect(found, `${base}${slug}`).toBe(true);
      }
    }
    for (const { directory } of ARCHIVE_GROUPS) expect(fs.existsSync(path.join(DOCS, "src", "content", "docs", directory)), directory).toBe(true);
  });

  it("is what the sidebar's archive group is built from, and the notice replaces Starlight's banner", () => {
    const config = fs.readFileSync(path.join(DOCS, "astro.config.mjs"), "utf8");
    expect(config).toMatch(/items: ARCHIVE_PAGES/);
    expect(config).toMatch(/ARCHIVE_GROUPS\.map/);
    expect(config).toMatch(/Banner: '\.\/src\/components\/ArchiveBanner\.astro'/);
  });
});
