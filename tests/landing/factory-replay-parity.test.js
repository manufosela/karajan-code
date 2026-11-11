// KJL-TSK-0163 (ADR 0052): the landing's starter builds the scene the way the board's
// does. If the scene's contract changes, this fails before the factory page breaks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (url) => readFileSync(new URL(url, import.meta.url), "utf8");
const live = read("../../packages/hu-board/public/stage/live.js");
const factory = read("../../packages/hu-board/public/stage/factory.js");
const replay = read("../../apps/landing/public/factory/replay.js");

const signature = /export function createLive\(\{([^}]*)\}, \{([^}]*)\}\)/.exec(live);
const keys = (text) => text.split(",").map((k) => k.split(":")[0].trim()).filter(Boolean);

describe("factory replay starter parity", () => {
  it("returns from buildScene every key createLive destructures, except origin", () => {
    expect(signature).not.toBeNull();
    const returned = /return \{([^}]*)\};/.exec(replay.slice(replay.indexOf("function buildScene")));
    const wanted = keys(signature[1]).filter((k) => k !== "origin");
    expect(wanted).toContain("scene");
    for (const key of wanted) expect(keys(returned[1])).toContain(key);
  });

  it("takes exactly state, tell and counts as the second parameter", () => {
    expect(keys(signature[2])).toEqual(["state", "tell", "counts"]);
  });

  it("buildFactory still returns hall, wall, releaseTable and spreads populate", () => {
    const body = factory.slice(factory.indexOf("export function buildFactory"));
    const ret = /return \{([^;]*)\};/.exec(body)[1];
    for (const part of ["...populate(", "hall:", "wall:", "releaseTable:"]) expect(ret).toContain(part);
  });

  it("imports from the scene only names the board's modules export", () => {
    const expected = {
      "factory.js": ["buildFactory", "createFactory", "framing"],
      "layout.js": ["hallDepth", "hallWidth"],
      "live.js": ["createLive"],
      "rest.js": ["acrossLanes"],
      "zoom.js": ["listenZoom"],
      "marks.js": ["MARK_MS"],
    };
    for (const [file, names] of Object.entries(expected)) {
      const source = read(`../../packages/hu-board/public/stage/${file}`);
      expect(replay).toContain(`'${file.replace(".js", "")}'`);
      for (const name of names) expect(replay).toContain(name);
      for (const name of names) expect(source).toMatch(new RegExp(`export (async )?(function|const|class) ${name}\\b`));
    }
  });
});
