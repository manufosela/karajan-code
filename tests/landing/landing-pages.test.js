import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T, SLOTS } from "../../apps/landing/public/film/timeline.js";

// KJL-TSK-0146: the 5.0 landing in English and Spanish shares the film, the CSS
// and the page script. Firebase caches .js and .css as immutable, so every module
// the film loads must go through the import map with the release's ?v=.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const pages = { en: "index.html", es: "es/index.html" };
const read = (path) => readFileSync(new URL(path, publicDir), "utf8");
const filmModules = readdirSync(new URL("film/", publicDir)).filter((f) => f.endsWith(".js"));
// Both languages sort the crates the same way; English is the reference.
const enKinds = read(pages.en).match(/data-kinds="([^"]+)"/)?.[1].split("|");

describe.each(Object.entries(pages))("landing page (%s)", (lang, path) => {
  const html = read(path);
  const version = html.match(/\/film\/main\.js\?v=([\d.]+)/)?.[1];
  const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

  it("declares its language", () => {
    expect(html).toContain(`<html lang="${lang}">`);
  });

  it("versions every film module, the page script and the CSS with the same release", () => {
    expect(version).toBeTruthy();
    for (const file of filmModules.filter((f) => f !== "main.js")) {
      expect(importMap[`/film/${file}`]).toBe(`/film/${file}?v=${version}`);
    }
    expect(html).toContain(`/js/page.js?v=${version}`);
    expect(html).toContain(`/css/landing.css?v=${version}`);
    expect(importMap.three).toMatch(/^\/lib\/three\.min\.js\?v=/);
  });

  it("gives the film one caption per beat, in order and inside the film", () => {
    const captions = [...html.matchAll(/<li data-from="([\d.]+)" data-to="([\d.]+)">[^<]+<\/li>/g)].map(([, a, b]) => [+a, +b]);
    expect(captions).toHaveLength(6);
    captions.forEach(([from, to], i) => {
      expect(from).toBeLessThan(to);
      expect(to).toBeLessThan(T.end);
      if (i > 0) expect(from).toBeGreaterThanOrEqual(captions[i - 1][1]);
    });
  });

  it("labels one crate per slot on the staff", () => {
    expect(html.match(/data-tools="([^"]+)"/)[1].split("|")).toHaveLength(SLOTS.length);
  });

  it("sorts every crate into the method or the tools, and lists both groups", () => {
    const kinds = html.match(/data-kinds="([^"]+)"/)[1].split("|");
    expect(kinds).toEqual(enKinds);
    expect(kinds).toHaveLength(SLOTS.length);
    expect(new Set(kinds)).toEqual(new Set(["method", "tool"]));
    const items = (kind) => html.match(new RegExp(`<ol class="pieces[^"]*" data-kind="${kind}">([\\s\\S]*?)</ol>`))[1].match(/<li>/g);
    expect(items("method")).toHaveLength(7);
    // The tools are the green crates plus atril, which stands by the podium.
    expect(items("tool")).toHaveLength(kinds.filter((k) => k === "tool").length + 1);
    expect(html.match(/data-tools="([^"]+)"/)[1]).not.toContain(html.match(/data-new-tool="([^"]+)"/)[1]);
  });

  it("lets the visitor skip and replay the film", () => {
    expect(html).toContain('id="skip"');
    expect(html).toContain('id="replay"');
  });

  it("only points at images that exist", () => {
    for (const [, src] of html.matchAll(/src="\/(img\/[^"]+)"/g)) {
      expect(existsSync(new URL(src, publicDir)), src).toBe(true);
    }
  });

  // KJL-BUG-0009: defer scripts and modules run in order, so a hung third-party
  // script held back the film. Anything from another origin loads async.
  it("never lets a third-party script hold back the film", () => {
    const external = [...html.matchAll(/<script\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>/g)].map(([tag]) => tag);
    expect(external.length).toBeGreaterThan(0);
    for (const tag of external) {
      expect(tag).toMatch(/\basync\b/);
      expect(tag).not.toMatch(/\bdefer\b/);
    }
  });

  it("writes no em dashes", () => {
    expect(html).not.toMatch(/—|&mdash;/);
  });
});
