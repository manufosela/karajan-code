import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0153: the family page shows each member with its character.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const read = (path) => readFileSync(new URL(path, publicDir), "utf8");
const bench = readFileSync(new URL("../../apps/landing/portraits/index.html", import.meta.url), "utf8");

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

// KJL-TSK-0154: every rendered portrait can be made again from the bench.
describe("portrait bench", () => {
  it("renders every portrait the family pages show", () => {
    const shown = new Set([...read("family.html").matchAll(/src="\/img\/([a-z]+)-320\.webp"/g)].map(([, name]) => name));
    const cast = [...bench.matchAll(/^ {2}([a-z]+): \(\) =>/gm)].map(([, name]) => name);
    expect(shown.size).toBeGreaterThan(0);
    for (const name of shown) expect(cast, name).toContain(name);
  });

  it("paints the glow flat, as the film's bloom would show it", () => {
    expect(bench).toContain("new THREE.MeshBasicMaterial({ color: mesh.material.emissive, toneMapped: false })");
  });
});
