import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-BUG-0007: the hero stacks the copy over the film on narrow or near-square
// screens, and the film frames its final shot for that layout. The CSS and the
// film must agree on when that happens, or the cast lands under the copy.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/${path}`, import.meta.url), "utf8");
const css = read("css/landing.css");
const film = read("film/main.js");

describe("hero layout", () => {
  it("uses the same media query in the CSS and in the film", () => {
    const filmQuery = film.match(/const stacked = matchMedia\('([^']+)'\)/)?.[1];
    expect(filmQuery).toBeTruthy();
    expect(css).toContain(`@media ${filmQuery} {`);
  });

  it("frames the final shot from where the copy ends, not from a fixed share of the screen", () => {
    expect(film).toContain("copyRight * aside");
    expect(film).toContain("copyBottom * aside");
  });
});
