import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0159 (ADR 0052): /factory/ explains the scene and /factory/play/ shows it full screen.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/factory/${path}`, import.meta.url), "utf8");

describe("the factory scene page", () => {
  it("lives at /factory/play/ and loads the starter next to the scene", () => {
    const play = read("play/index.html");
    expect(play).toContain('<script type="module" src="../replay.js"></script>');
    expect(play).toContain('"three": "/lib/three.min.js"');
  });

  it("finds the scene, the trace and their style from the starter's own URL", () => {
    const replay = read("replay.js");
    for (const file of ["stage.json", "demo-hu-3870.json"]) expect(replay).toContain(`new URL('./${file}', import.meta.url)`);
    expect(replay).not.toMatch(/fetch\('\.\//);
  });
});

describe("the factory article", () => {
  const article = read("index.html");

  it("links to the full-screen replay and says how to run it locally", () => {
    expect(article).toContain('href="/factory/play/"');
    expect(article).toContain("kj stage");
    expect(article).not.toContain("—");
  });

  it("names every piece of the scene", () => {
    for (const id of ["workshops", "sentinel", "gates", "review", "checks", "wall", "courier", "atril", "map"]) {
      expect(article).toContain(`id="${id}"`);
    }
  });
});
