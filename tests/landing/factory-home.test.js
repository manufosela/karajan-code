import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0160: each home shows the still of the Factory, lazily, and links to its article.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/${path}`, import.meta.url), "utf8");
const block = (html) => html.match(/<section class="band" id="factory">[\s\S]*?<\/section>/)?.[0] ?? "";

describe.each([
  ["index.html", "/factory/"],
  ["es/index.html", "/es/factory/"],
])("the Factory block of %s", (home, article) => {
  const html = read(home);

  it("shows the still without weighing on the first paint", () => {
    expect(block(html)).toMatch(/<img src="\/img\/factory-hu-3870\.jpg" width="1568" height="684" loading="lazy" decoding="async" alt="[^"]+">/);
  });

  it("links to the article in its own language", () => {
    expect(block(html)).toContain(`<a href="${article}">`);
  });

  it("keeps a single cache key for the home's own assets", () => {
    const keys = [...html.matchAll(/"\/(?:css|film|js)\/[^"?]+\?v=([\d.]+)"/g)].map(([, key]) => key);
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(1);
  });
});
