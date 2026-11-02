import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0153: the family page shows each member with its character.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const read = (path) => readFileSync(new URL(path, publicDir), "utf8");
const bench = readFileSync(new URL("../../apps/landing/portraits/index.html", import.meta.url), "utf8");

// Each character's portrait, rendered from its three.js module (KJL-TSK-0153, KJL-TSK-0154).
// A member the page does not list (the Spanish page has no Libretto yet) is skipped.
const PORTRAITS = ["atril", "libretto"];

describe.each(["family.html", "es/family.html"])("%s", (page) => {
  const html = read(page);

  it.each(PORTRAITS)("gives %s its character's portrait instead of a monogram", (name) => {
    if (!html.includes(`<span class="monogram">${name}</span>`) && !html.includes(`/img/${name}-320.webp`)) return;
    const img = html.match(new RegExp(`<img src="/(img/${name}-320\\.webp)" alt="([^"]+)"[^>]*>`));
    expect(img, `${name} portrait`).toBeTruthy();
    expect(existsSync(new URL(img[1], publicDir))).toBe(true);
    expect(img[2].toLowerCase()).toContain(name);
    expect(html).not.toContain(`<span class="monogram">${name}</span>`);
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
