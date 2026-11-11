import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0164: the Factory article in Spanish, the same pieces as the English one, linked from both homes.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/${path}`, import.meta.url), "utf8");
const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id);

describe("the Spanish factory article", () => {
  const en = read("factory/index.html");
  const es = read("es/factory/index.html");

  it("has the same sections as the English one", () => {
    expect(ids(es)).toEqual(ids(en));
  });

  it("is in Spanish, links to the replay and says how to run it", () => {
    expect(es).toContain('<html lang="es">');
    expect(es).toContain('href="/factory/play/"');
    expect(es).toContain("kj stage");
    expect(es).not.toContain("—");
  });

  it("and the English one point to each other", () => {
    expect(es).toContain('<link rel="alternate" hreflang="en" href="/factory/">');
    expect(en).toContain('<link rel="alternate" hreflang="es" href="/es/factory/">');
    expect(en).toContain('href="/es/factory/" lang="es"');
  });
});

describe("the home navigation", () => {
  it("links to the Factory in its own language", () => {
    expect(read("index.html")).toContain('<a href="/factory/">Factory</a>');
    expect(read("es/index.html")).toContain('<a href="/es/factory/">Factory</a>');
  });
});
