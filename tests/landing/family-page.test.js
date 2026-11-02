import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0153: the family page shows each member with its character.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const read = (path) => readFileSync(new URL(path, publicDir), "utf8");

describe.each(["family.html", "es/family.html"])("%s", (page) => {
  const html = read(page);

  it("gives atril its robot portrait, rendered from the film's model", () => {
    const img = html.match(/<img src="\/(img\/atril-[^"]+)" alt="([^"]+)"[^>]*>/);
    expect(img, "atril portrait").toBeTruthy();
    expect(existsSync(new URL(img[1], publicDir))).toBe(true);
    expect(img[2]).toMatch(/atril/);
    expect(html).not.toContain('<span class="monogram">atril</span>');
  });
});
