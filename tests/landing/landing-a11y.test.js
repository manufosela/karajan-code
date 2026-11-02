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
});
