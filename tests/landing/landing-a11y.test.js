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

  // KJL-BUG-0012 (4.1.2): the theme button says whether the dark theme is on.
  it("exposes the theme button as a toggle with its state", () => {
    expect(html).toMatch(/<button[^>]*id="theme"[^>]*aria-pressed=/);
    expect(html).toContain("theme.setAttribute('aria-pressed'");
    expect(html).not.toMatch(/onclick=|\bvar [a-z]/);
  });
});

// KJL-BUG-0012 (4.1.3, 4.1.2): the home pages.
describe.each(["index.html", "es/index.html"])("%s", (page) => {
  const html = read(page);
  const script = read("js/page.js");

  it("announces the copy through a status region", () => {
    expect(html).toMatch(/<output[^>]*id="copy-status"[^>]*aria-live="polite"/);
    expect(script).toContain("copyStatus.textContent = copy.textContent");
  });

  it("exposes the theme button as a toggle with its state", () => {
    expect(html).toMatch(/<button[^>]*id="theme"[^>]*aria-pressed=/);
    expect(script).toContain("theme.setAttribute('aria-pressed'");
  });

  // KJL-BUG-0013 (2.2.2): moving content that lasts over 5 s can be paused.
  it("lets the visitor pause the living hero, and remembers it", () => {
    expect(html).toMatch(/<button[^>]*id="pause"[^>]*aria-pressed="false"/);
    const film = read("film/main.js");
    expect(film).toContain("pause.setAttribute('aria-pressed'");
    expect(film).toContain("localStorage.setItem('kj-hero-paused'");
    expect(film).toMatch(/if \(held\(\)\) \{ playing = false; return; \}/);
  });

  it("types the terminal out in under 5 seconds", () => {
    const [, start, prompt, output] = script.match(/let at = (\d+);[\s\S]*?\? (\d+) : (\d+);/).map(Number);
    const term = html.match(/id="term"[\s\S]*?<\/div>\s*<\/div>/)[0];
    const lines = term.match(/<p[ >]/g).length;
    const prompts = term.match(/class="ps"/g).length;
    expect(start + prompts * prompt + (lines - prompts) * output).toBeLessThan(5000);
  });

  it("hides the controls that do nothing when motion is reduced", () => {
    expect(read("css/landing.css")).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*?#replay, #pause \{ display: none; \}/);
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
