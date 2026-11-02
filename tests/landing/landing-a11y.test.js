import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0151: fixes from the manual WCAG 2.2 AA review of the 5.0 landing.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/${path}`, import.meta.url), "utf8");

describe("landing accessibility", () => {
  // KJL-BUG-0010 (2.4.7): only Skip intro is on screen while the film plays, so
  // Tab must not reach the rest of the page until it ends.
  it("keeps the page behind the film out of the tab order while it plays", () => {
    const main = read("film/main.js");
    expect(main).toContain("querySelectorAll('.skip-link, .top, #main, footer')");
    const body = (name) => main.match(new RegExp(`function ${name}\\(\\) \\{([\\s\\S]*?)\\n *\\}\\n`))[1];
    expect(body("playFilm")).toContain("veil(true)");
    expect(body("finish")).toContain("veil(false)");
  });

  // KJL-BUG-0011 (1.4.11): the focus ring follows the theme, at least 3:1 on the
  // light page and on the dark hero it sits over in both themes.
  it("draws the focus ring in the theme's gold ink", () => {
    const css = read("css/landing.css");
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--gold-ink\)/);
    const lightInk = css.match(/\[data-theme="light"\] \{[^}]*--gold-ink: (#[0-9a-f]{6})/)[1];
    expect(contrast(lightInk, "#f4f7f9")).toBeGreaterThanOrEqual(3);
    expect(contrast(lightInk, "#05080d")).toBeGreaterThanOrEqual(3);
  });
});

// KJL-BUG-0011 (1.4.3, 1.4.1): the method and family pages.
describe.each(["method.html", "es/method.html", "family.html", "es/family.html"])("%s", (page) => {
  const html = read(page);

  it("keeps the light theme's gold text at 4.5:1 on its backgrounds", () => {
    const deep = html.match(/--baton-gold-deep: (#[0-9a-f]{6})/)[1];
    expect(contrast(deep, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(deep, "#f4f7f9")).toBeGreaterThanOrEqual(4.5);
  });

  it("never fades text below its contrast, not even the card still in the works", () => {
    expect(html).not.toMatch(/\.brewing \{[^}]*opacity/);
  });

  it("underlines the footer links, so colour is not the only cue", () => {
    expect(html).toMatch(/\.foot a \{[^}]*text-decoration: underline/);
  });
});

// WCAG relative-luminance contrast ratio between two #rrggbb colours.
function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
